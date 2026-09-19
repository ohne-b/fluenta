//! Stable, bounded pages. A cursor becomes invalid when its query or active packs change.
use super::*;

const PAGE_SIZE: usize = 20;
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    scope: String,
    pack: usize,
    rank: f64,
    id: String,
}
impl Cursor {
    fn read(packs: &[&PackInfo], tag: &str, encoded: Option<&str>) -> Result<Self> {
        let mut hash = Sha256::new();
        hash.update(tag);
        for pack in packs {
            hash.update(pack.release_id.as_str());
            hash.update(b"\n");
        }
        let scope = format!("{:x}", hash.finalize());
        if let Some(encoded) = encoded {
            if encoded.len() > 1024 {
                return Err(Error::Invalid("content.cursor_invalid".into()));
            }
            let cursor: Self = serde_json::from_str(encoded)?;
            if cursor.scope != scope
                || cursor.pack >= packs.len()
                || !cursor.rank.is_finite()
                || cursor.id.len() > 160
            {
                return Err(Error::Invalid("content.cursor_invalid".into()));
            }
            Ok(cursor)
        } else {
            Ok(Self {
                scope,
                pack: 0,
                rank: -f64::MAX,
                id: String::new(),
            })
        }
    }
    fn next_pack(&mut self) {
        self.pack += 1;
        self.rank = -f64::MAX;
        self.id.clear();
    }
    fn encode(&self) -> Result<Option<String>> {
        Ok(Some(serde_json::to_string(self)?))
    }
}

impl Catalog {
    pub fn search_page(
        &self,
        locale: SourceLanguage,
        query: &str,
        encoded: Option<&str>,
    ) -> Result<(Vec<SearchHit>, Option<String>)> {
        let tokens: Vec<_> = query
            .split_whitespace()
            .take(12)
            .map(|s| format!("\"{}\"*", s.replace('"', "\"\"")))
            .collect();
        if tokens.is_empty() || query.len() > 512 {
            return Ok((vec![], None));
        }
        let packs: Vec<_> = self
            .packs
            .iter()
            .rev()
            .filter(|p| p.active && p.course.source_language == locale)
            .collect();
        let mut cursor = Cursor::read(
            &packs,
            &format!("search:{}:{query}", locale.code()),
            encoded,
        )?;
        let expression = tokens.join(" AND ");
        let mut hits = Vec::new();
        while cursor.pack < packs.len() {
            let db = open_readonly(&packs[cursor.pack].path)?;
            let mut statement = db.prepare("SELECT id,revision,substr(text,1,240),rank FROM search WHERE search MATCH ?1 AND kind='material' AND (rank>?2 OR (rank=?2 AND id>?3)) ORDER BY rank,id LIMIT 21")?;
            for row in statement.query_map(params![expression, cursor.rank, cursor.id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, u32>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, f64>(3)?,
                ))
            })? {
                if hits.len() == PAGE_SIZE {
                    return Ok((hits, cursor.encode()?));
                }
                let (id, revision, text, rank) = row?;
                cursor.id = id.clone();
                cursor.rank = rank;
                hits.push(SearchHit {
                    content: ContentRef {
                        id: id.try_into().map_err(Error::Invalid)?,
                        revision: revision
                            .try_into()
                            .map_err(|_| Error::Invalid("zero revision".into()))?,
                    },
                    title: Text {
                        annotations: vec![],
                        language: locale.language(),
                        text: text.chars().take(75).collect(),
                    },
                    excerpt: Text {
                        annotations: vec![],
                        language: locale.language(),
                        text,
                    },
                });
            }
            cursor.next_pack();
        }
        Ok((hits, None))
    }
    pub fn units_page(
        &self,
        locale: SourceLanguage,
        band: Band,
        encoded: Option<&str>,
    ) -> Result<(Vec<Unit>, Option<String>)> {
        let packs: Vec<_> = self
            .packs
            .iter()
            .filter(|p| p.active && p.course.source_language == locale && p.course.band == band)
            .collect();
        let mut cursor = Cursor::read(
            &packs,
            &format!("units:{}:{band:?}", locale.code()),
            encoded,
        )?;
        let mut items = Vec::new();
        while cursor.pack < packs.len() {
            let db = open_readonly(&packs[cursor.pack].path)?;
            let mut statement = db.prepare(
                "SELECT id,payload FROM entities WHERE kind='unit' AND id>?1 ORDER BY id LIMIT 21",
            )?;
            for row in statement.query_map([&cursor.id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })? {
                if items.len() == PAGE_SIZE {
                    return Ok((items, cursor.encode()?));
                }
                let (id, payload) = row?;
                cursor.id = id;
                items.push(serde_json::from_str(&payload)?);
            }
            cursor.next_pack();
        }
        Ok((items, None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn search_pages_do_not_repeat_or_drop_equal_rank_hits_and_reject_changed_queries() {
        let directory = tempfile::tempdir().unwrap();
        compile_source(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../content/foundation"),
            directory.path(),
        )
        .unwrap();
        let catalog = Catalog::open(directory.path()).unwrap();
        for (index, pack) in catalog
            .packs
            .iter()
            .filter(|p| p.course.source_language == SourceLanguage::En)
            .take(2)
            .enumerate()
        {
            let db = Connection::open(&pack.path).unwrap();
            for row in 0..35 {
                db.execute("INSERT INTO search(id,revision,kind,text) VALUES(?1,1,'material','pagination sample')", [format!("pagination.{index}.{row:03}")]).unwrap();
            }
            let rank: f64 = db
                .query_row(
                    "SELECT rank FROM search WHERE search MATCH 'pagination' LIMIT 1",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            let decoded: f64 =
                serde_json::from_str(&serde_json::to_string(&rank).unwrap()).unwrap();
            assert_eq!(
                rank.to_bits(),
                decoded.to_bits(),
                "rank cursors must not drift between pages"
            );
        }
        let mut seen = BTreeSet::new();
        let mut cursor = None;
        loop {
            let (items, next) = catalog
                .search_page(SourceLanguage::En, "pagination", cursor.as_deref())
                .unwrap();
            assert!(items.len() <= 20);
            for hit in items {
                assert!(seen.insert(hit.content.id));
            }
            if cursor.is_none() {
                assert!(next.is_some());
            }
            if let Some(ref next) = next {
                assert!(
                    catalog
                        .search_page(SourceLanguage::En, "other", Some(next))
                        .is_err()
                );
            }
            cursor = next;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(seen.len(), 70);
    }
}
