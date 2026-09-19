use super::*;

pub(super) fn validate_connected(pack: &CoursePack, records: &[(&str, Value)]) -> Result<()> {
    let invalid = |message: &str| Error::Invalid(format!("connected learning: {message}"));
    if pack.topics.is_empty() && pack.missions.is_empty() && pack.occurrences.is_empty() {
        return Ok(());
    }
    if pack.schema_version.get() < 4 {
        return Err(invalid("schema 4 required"));
    }
    let entity = |reference: &ContentRef, kind: &str| {
        records
            .iter()
            .find(|(k, v)| {
                *k == kind
                    && v["content"]["id"] == reference.id.as_str()
                    && v["content"]["revision"] == reference.revision.get()
            })
            .map(|(_, v)| v)
            .ok_or_else(|| invalid("wrong reference kind"))
    };
    fn annotations(value: &Value, pack: &CoursePack, owner: &ContentRef) -> Result<()> {
        match value {
            Value::Object(object) => {
                if let Some(ranges) = object.get("annotations") {
                    let text: Text = serde_json::from_value(value.clone())?;
                    if text.language != Language::Es {
                        return Err(Error::Invalid("only Spanish text can be annotated".into()));
                    }
                    let chars: Vec<_> = text.text.chars().collect();
                    let mut end = 0;
                    for range in serde_json::from_value::<Vec<Annotation>>(ranges.clone())? {
                        let occurrence = pack
                            .occurrences
                            .iter()
                            .find(|o| o.content == range.occurrence)
                            .ok_or_else(|| Error::Invalid("unknown occurrence".into()))?;
                        if range.start < end
                            || range.start >= range.end
                            || range.end as usize > chars.len()
                            || occurrence.owner != *owner
                            || chars[range.start as usize..range.end as usize]
                                .iter()
                                .collect::<String>()
                                != occurrence.surface
                        {
                            return Err(Error::Invalid(
                                "invalid, overlapping or mismatched authored annotation".into(),
                            ));
                        }
                        end = range.end;
                    }
                }
                for (key, child) in object {
                    if key != "content" {
                        annotations(child, pack, owner)?;
                    }
                }
            }
            Value::Array(items) => {
                for child in items {
                    annotations(child, pack, owner)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    for (_, value) in records {
        annotations(
            value,
            pack,
            &serde_json::from_value(value["content"].clone())?,
        )?;
    }
    for occurrence in &pack.occurrences {
        entity(&occurrence.sense, "vocabulary")?;
        if occurrence.surface.trim().is_empty()
            || occurrence.context.language != Language::Es
            || !occurrence.context.text.contains(&occurrence.surface)
            || occurrence.meaning.language != pack.course.source_language.language()
        {
            return Err(invalid(
                "occurrence needs a Spanish sentence and contextual teaching translation",
            ));
        }
        let owner = records
            .iter()
            .find(|(_, v)| v["content"]["id"] == occurrence.owner.id.as_str())
            .ok_or_else(|| invalid("occurrence owner missing"))?;
        if !matches!(owner.0, "material" | "activity")
            || !serde_json::to_string(&owner.1)?.contains(&format!("\"{}\"", occurrence.content.id))
        {
            return Err(invalid("occurrence must be annotated in its owner"));
        }
        if let Some(speech) = &occurrence.speech {
            entity(speech, "speech")?;
        }
    }
    for sense in &pack.vocabulary {
        for practice in &sense.practice {
            let a: Activity = serde_json::from_value(entity(practice, "activity")?.clone())?;
            if !a.usage.is_practice() || !a.lexical.iter().any(|p| p.sense == sense.content) {
                return Err(invalid("lexical practice must target its sense"));
            }
        }
        for topic in &sense.topics {
            if !pack.topics.iter().any(|t| t.content.id == *topic) {
                return Err(invalid("unknown vocabulary topic"));
            }
        }
    }
    for activity in &pack.activities {
        for target in &activity.lexical {
            entity(&target.sense, "vocabulary")?;
            let occurrence: Occurrence =
                serde_json::from_value(entity(&target.occurrence, "occurrence")?.clone())?;
            if occurrence.sense != target.sense {
                return Err(invalid("lexical practice sense mismatch"));
            }
        }
    }
    let mut practice_material = BTreeSet::new();
    for a in pack.activities.iter().filter(|a| a.usage.is_practice()) {
        for r in a.materials.iter().chain(&a.hints) {
            practice_material.insert(r.id.clone());
        }
        if let Task::Explanation { material } = &a.task {
            practice_material.insert(material.id.clone());
        }
    }
    let practice_text: BTreeSet<_> = pack
        .materials
        .iter()
        .filter(|m| practice_material.contains(&m.content.id))
        .map(|m| serde_json::to_value(m).map(|v| plain_text(&v)))
        .collect::<std::result::Result<_, _>>()?;
    for mission in &pack.missions {
        entity(&mission.lesson, "lesson")?;
        let challenge: Assessment =
            serde_json::from_value(entity(&mission.challenge, "assessment")?.clone())?;
        if mission.vocabulary.is_empty()
            || mission.sources.is_empty()
            || mission.attribution.text.is_empty()
        {
            return Err(invalid(
                "mission needs vocabulary, provenance and attribution",
            ));
        }
        for r in &mission.vocabulary {
            entity(r, "vocabulary")?;
        }
        let mut fresh = false;
        for r in &challenge.activities {
            let a: Activity = serde_json::from_value(entity(r, "activity")?.clone())?;
            for material in &a.materials {
                let m: Material = serde_json::from_value(entity(material, "material")?.clone())?;
                if m.searchable
                    || practice_material.contains(&material.id)
                    || practice_text.contains(&plain_text(&serde_json::to_value(&m)?))
                {
                    return Err(invalid("challenge source is not held out"));
                }
                fresh = true;
            }
        }
        if !fresh {
            return Err(invalid("challenge requires unseen material"));
        }
    }
    for topic in &pack.topics {
        if topic.missions.is_empty() || topic.outcomes.is_empty() || topic.sources.is_empty() {
            return Err(invalid("empty topic"));
        }
        for r in &topic.missions {
            entity(r, "mission")?;
        }
    }
    for source in pack
        .topics
        .iter()
        .flat_map(|t| &t.sources)
        .chain(pack.missions.iter().flat_map(|m| &m.sources))
    {
        if !source.url.starts_with("https://")
            || source.url.len() > 2048
            || source.accessed.len() != 10
            || source.title.trim().is_empty()
        {
            return Err(invalid("invalid factual source"));
        }
    }
    Ok(())
}

impl Catalog {
    pub fn connected_topics(&self, locale: SourceLanguage) -> Result<Vec<Topic>> {
        let mut topics = BTreeMap::new();
        for pack in self
            .packs
            .iter()
            .filter(|p| p.active && p.course.source_language == locale)
        {
            for topic in self.list::<Topic>(&pack.release_id, "topic")? {
                topics.insert(topic.content.id.clone(), topic);
            }
        }
        Ok(topics.into_values().collect())
    }
}
