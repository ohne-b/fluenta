//! Student SQLite owns durable state; compiled curriculum remains immutable.
use fluenta_content::Catalog;
use fluenta_contracts::*;
use rusqlite::{Connection, OptionalExtension, params};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

mod connected;
mod recovery;
mod sessions;
mod tutor;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Invalid(String),
    #[error("state.conflict")]
    Conflict,
    #[error("{0}")]
    Policy(String),
    #[error("content.not_found")]
    NotFound,
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Content(#[from] fluenta_content::Error),
}
pub type Result<T> = std::result::Result<T, Error>;
pub fn new_id() -> Id {
    uuid::Uuid::new_v4().to_string().try_into().unwrap()
}
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
fn json<T: serde::Serialize>(value: &T) -> Result<String> {
    Ok(serde_json::to_string(value)?)
}
fn from_json<T: serde::de::DeserializeOwned>(value: &str) -> Result<T> {
    Ok(serde_json::from_str(value)?)
}

pub struct Store {
    pub(crate) db: Connection,
    pub directory: PathBuf,
}
impl Store {
    pub fn open(directory: &Path) -> Result<Self> {
        fs::create_dir_all(directory)?;
        let mut db = Connection::open(directory.join("student.sqlite"))?;
        db.busy_timeout(Duration::from_secs(3))?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;")?;
        let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version == 0 {
            let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            tx.execute_batch(include_str!("schema.sql"))?;
            tx.commit()?;
        } else if !matches!(version, 1 | 2) {
            return Err(Error::Invalid("storage.unsupported_version".into()));
        }
        migrate(&mut db)?;
        Self::validate_backup(&directory.join("student.sqlite"))?;
        Ok(Self {
            db,
            directory: directory.to_owned(),
        })
    }
    pub fn settings(&self) -> Result<Settings> {
        let value: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM settings WHERE key='preferences'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        value
            .map(|value| from_json(&value))
            .unwrap_or_else(|| Ok(Settings::default()))
    }
    pub fn installed_courses(&self) -> Result<Vec<fluenta_content::release::Release>> {
        let value: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM settings WHERE key='content_releases'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        value.map(|v| from_json(&v)).unwrap_or_else(|| Ok(vec![]))
    }
    pub fn activate_courses(&self, release: fluenta_content::release::Release) -> Result<()> {
        let mut releases = self.installed_courses()?;
        // One SQLite write switches new sessions to the complete, verified release.
        // Old pack files remain available to pinned sessions and review items.
        for prior in &mut releases {
            prior.files.retain(|old| {
                !release.files.iter().any(|new| {
                    new.course.content.id == old.course.content.id
                        && new.course.source_language == old.course.source_language
                })
            });
        }
        releases.retain(|r| !r.files.is_empty());
        releases.push(release);
        self.db.execute("INSERT INTO settings(key,value) VALUES('content_releases',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[json(&releases)?])?;
        Ok(())
    }
    pub fn save_settings(&self, settings: Settings) -> Result<Settings> {
        if !(5..=60).contains(&settings.daily_minutes) {
            return Err(Error::Invalid("settings.goal_range".into()));
        }
        self.db.execute("INSERT INTO settings(key,value) VALUES('preferences',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[json(&settings)?])?;
        Ok(settings)
    }
    pub fn check_reference_access(&self) -> Result<()> {
        let active: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM sessions WHERE mode='test' AND status='active')",
            [],
            |r| r.get(0),
        )?;
        if active {
            Err(Error::Policy("test.finish_first".into()))
        } else {
            Ok(())
        }
    }
    pub fn overview(&self, catalog: &Catalog, tutor_installed: bool, now: i64) -> Result<Overview> {
        let settings = self.settings()?;
        let locale = settings.source_language;
        let mut completed = BTreeSet::new();
        for row in self.db.prepare("SELECT DISTINCT target_id FROM sessions WHERE status='completed' AND source_language=?1 AND mode='lesson'")?.query_map([locale.code()],|r|r.get::<_,String>(0))? { completed.insert(row?); }
        let continue_session: Option<String> = self
            .db
            .query_row(
                "SELECT id FROM sessions WHERE status='active' ORDER BY updated_ms DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        let mut units = catalog.unit_overviews(locale)?;
        for unit in &mut units {
            for lesson in &mut unit.lessons {
                lesson.completed = completed.contains(lesson.content.id.as_str());
            }
        }
        units.sort_by_key(|u| {
            (
                match u.band {
                    Band::A1 => 0,
                    Band::A2 => 1,
                    Band::B1 => 2,
                    Band::B2 => 3,
                },
                u.content.id.to_string(),
            )
        });
        let recommended_lesson = units
            .iter()
            .filter(|u| u.band == settings.starting_band)
            .chain(units.iter())
            .flat_map(|u| &u.lessons)
            .find(|l| !l.completed)
            .map(|l| l.content.clone())
            .or_else(|| {
                units
                    .first()
                    .and_then(|u| u.lessons.first())
                    .map(|l| l.content.clone())
            });
        let due_reviews=self.db.query_row("SELECT count(*) FROM reviews WHERE (source_language=?1 OR source_language='es') AND sense_id IS NULL AND due_ms<=?2",params![locale.code(),now],|r|r.get(0))?;
        let today_attempts=self.db.query_row("SELECT count(*) FROM attempts WHERE created_ms>=unixepoch(date(?1/1000,'unixepoch','localtime'),'utc')*1000 AND created_ms<unixepoch(date(?1/1000,'unixepoch','localtime','+1 day'),'utc')*1000",[now],|r|r.get(0))?;
        let mut statement=self.db.prepare("WITH RECURSIVE days(n) AS (VALUES(6) UNION ALL SELECT n-1 FROM days WHERE n>0) SELECT date(?1/1000,'unixepoch','localtime','-'||n||' days'),(SELECT count(*) FROM attempts WHERE created_ms>=unixepoch(date(?1/1000,'unixepoch','localtime','-'||n||' days'),'utc')*1000 AND created_ms<unixepoch(date(?1/1000,'unixepoch','localtime','-'||n||' days','+1 day'),'utc')*1000) FROM days ORDER BY n DESC")?;
        let week = statement
            .query_map([now], |r| {
                Ok(DayActivity {
                    day: r.get(0)?,
                    attempts: r.get(1)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Overview {
            settings,
            units,
            continue_session: continue_session
                .map(|x| x.try_into().map_err(Error::Invalid))
                .transpose()?,
            recommended_lesson,
            due_reviews,
            total_completed: completed.len() as u32,
            today_attempts,
            week,
            tutor_installed,
        })
    }
    pub fn toggle_bookmark(&self, locale: SourceLanguage, r: &ContentRef) -> Result<()> {
        if self.db.execute(
            "DELETE FROM bookmarks WHERE id=?1 AND source_language=?2",
            params![r.id.as_str(), locale.code()],
        )? == 0
        {
            self.db.execute(
                "INSERT INTO bookmarks(id,revision,source_language) VALUES(?1,?2,?3)",
                params![r.id.as_str(), r.revision.get(), locale.code()],
            )?;
        }
        Ok(())
    }
    pub fn bookmarks(&self, catalog: &Catalog, locale: SourceLanguage) -> Result<Vec<SearchHit>> {
        let mut hits = Vec::new();
        for row in self.db.prepare("SELECT id,revision FROM bookmarks WHERE source_language=?1 ORDER BY rowid DESC LIMIT 200")?.query_map([locale.code()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,u32>(1)?)))? {
            let (id,revision)=row?;let content=ContentRef{id:id.try_into().map_err(Error::Invalid)?,revision:revision.try_into().map_err(|_|Error::Invalid("content.revision".into()))?};
            let pack=catalog.locate(locale,&content)?; let material:Material=catalog.get(&pack.release_id,&content,"material")?;
            let text=fluenta_content::plain_text(&serde_json::to_value(material)?);
            hits.push(SearchHit{content,title:Text{annotations:vec![],language:locale.language(),text:text.chars().take(75).collect()},excerpt:Text{annotations:vec![],language:locale.language(),text:text.chars().take(240).collect()}});
        }
        Ok(hits)
    }
    pub fn backup(&self, destination: &Path) -> Result<()> {
        if destination.exists() {
            return Err(Error::Invalid("backup.destination_exists".into()));
        }
        self.db.backup("main", destination, None)?;
        Ok(())
    }
    pub fn validate_backup(path: &Path) -> Result<()> {
        let source = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        source.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;")?;
        let version: i64 = source.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        let integrity: String = source.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        let foreign_key_failures: bool = source.prepare("PRAGMA foreign_key_check")?.exists([])?;
        if !matches!(version, 1 | 2) || integrity != "ok" || foreign_key_failures {
            return Err(Error::Invalid("backup.invalid".into()));
        }
        if version == 2 {
            source.prepare("SELECT sense_id FROM reviews LIMIT 0")?;
            for table in [
                "vocabulary",
                "vocabulary_contexts",
                "lexical_evidence",
                "mission_sessions",
                "output_revisions",
                "notebook",
            ] {
                source.prepare(&format!("SELECT * FROM {table} LIMIT 0"))?;
            }
        }
        let settings: Option<String> = source
            .query_row(
                "SELECT value FROM settings WHERE key='preferences'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(settings) = settings {
            let _: Settings = from_json(&settings)?;
        }
        Ok(())
    }
    pub fn restore_database(&mut self, path: &Path) -> Result<()> {
        Self::validate_backup(path)?;
        let source = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let backup = rusqlite::backup::Backup::new(&source, &mut self.db)?;
        backup.run_to_completion(100, Duration::from_millis(10), None)?;
        drop(backup);
        migrate(&mut self.db)?;
        Ok(())
    }
}

fn migrate(db: &mut Connection) -> Result<()> {
    let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version == 1 {
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute_batch(include_str!("migration-2.sql"))?;
        tx.commit()?;
    }
    Ok(())
}
