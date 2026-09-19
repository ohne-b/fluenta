//! Validated curriculum compilation and indexed, read-only content access.
mod connected;
mod pages;
pub mod release;
use fluenta_contracts::*;
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::de::DeserializeOwned;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Invalid curriculum: {0}")]
    Invalid(String),
    #[error("Content not found: {0}")]
    NotFound(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
}
pub type Result<T> = std::result::Result<T, Error>;

pub fn reference(id: &str) -> ContentRef {
    ContentRef {
        id: id.to_string().try_into().expect("internal content ID"),
        revision: 1.try_into().unwrap(),
    }
}

fn records(pack: &CoursePack) -> Result<Vec<(&'static str, Value)>> {
    let mut all = vec![("course", serde_json::to_value(&pack.course)?)];
    macro_rules! append {
        ($kind:literal, $field:ident) => {
            for record in &pack.$field {
                all.push(($kind, serde_json::to_value(record)?));
            }
        };
    }
    append!("unit", units);
    append!("lesson", lessons);
    append!("objective", objectives);
    append!("activity", activities);
    append!("material", materials);
    append!("speech", speech);
    append!("vocabulary", vocabulary);
    append!("rubric", rubrics);
    append!("assessment", assessments);
    append!("grammar", grammar);
    append!("topic", topics);
    append!("mission", missions);
    append!("occurrence", occurrences);
    Ok(all)
}

fn references(value: &Value, output: &mut Vec<ContentRef>) -> Result<()> {
    match value {
        Value::Object(object) => {
            if object.len() == 2 && object.contains_key("id") && object.contains_key("revision") {
                output.push(serde_json::from_value(value.clone())?);
            } else {
                for (key, child) in object {
                    if key != "content" {
                        references(child, output)?;
                    }
                }
            }
        }
        Value::Array(items) => {
            for child in items {
                references(child, output)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn validate(pack: &CoursePack) -> Result<()> {
    if !matches!(pack.schema_version.get(), 1..=4)
        || pack.units.is_empty()
        || pack.lessons.is_empty()
    {
        return Err(Error::Invalid("unsupported schema or empty course".into()));
    }
    let all = records(pack)?;
    let mut definitions = BTreeMap::new();
    let mut ids = BTreeSet::new();
    for (kind, value) in &all {
        let content: ContentRef = serde_json::from_value(value["content"].clone())?;
        if !ids.insert(content.id.clone())
            || definitions
                .insert((content.id, content.revision), *kind)
                .is_some()
        {
            return Err(Error::Invalid("duplicate entity ID/revision".into()));
        }
    }
    for (_, value) in &all {
        let mut refs = Vec::new();
        references(value, &mut refs)?;
        for item in refs {
            if !definitions.contains_key(&(item.id.clone(), item.revision)) {
                return Err(Error::Invalid(format!("unresolved reference {}", item.id)));
            }
        }
        validate_text(value, pack.course.source_language)?;
    }
    let kind_of = |r: &ContentRef, expected: &str| -> Result<()> {
        if definitions.get(&(r.id.clone(), r.revision)).copied() != Some(expected) {
            return Err(Error::Invalid(format!(
                "{} must reference a {expected}",
                r.id
            )));
        }
        Ok(())
    };
    let activities: BTreeMap<_, _> = pack.activities.iter().map(|a| (&a.content.id, a)).collect();
    for topic in &pack.grammar {
        if pack.schema_version.get() < 3 && (topic.order != 0 || topic.group.is_some()) {
            return Err(Error::Invalid(
                "grammar ordering and groups require schema 3".into(),
            ));
        }
        if pack.schema_version.get() < 2
            || topic.band != pack.course.band
            || !(1..=20).contains(&topic.explanations.len())
            || !(1..=50).contains(&topic.lessons.len())
        {
            return Err(Error::Invalid("grammar courses require schema 2, the course band, explanations and practice lessons".into()));
        }
        for reference in &topic.explanations {
            kind_of(reference, "material")?;
            if !pack
                .materials
                .iter()
                .any(|m| m.content == *reference && m.searchable)
            {
                return Err(Error::Invalid(
                    "grammar explanations must be public reference materials".into(),
                ));
            }
        }
        for reference in &topic.lessons {
            kind_of(reference, "lesson")?;
        }
    }
    for objective in &pack.objectives {
        for reference in &objective.prerequisites {
            kind_of(reference, "objective")?;
        }
        for reference in &objective.explanation_refs {
            kind_of(reference, "material")?;
        }
    }
    for material in &pack.materials {
        if material.blocks.is_empty() || material.blocks.len() > 300 {
            return Err(Error::Invalid("material must have 1–300 blocks".into()));
        }
        for block in &material.blocks {
            match block {
                Block::Image { png, .. } => {
                    if png.len() < 33
                        || png.len() > 2_000_000
                        || png[..8] != [137, 80, 78, 71, 13, 10, 26, 10]
                        || png[12..16] != *b"IHDR"
                        || u32::from_be_bytes(png[16..20].try_into().unwrap()) > 4096
                        || u32::from_be_bytes(png[20..24].try_into().unwrap()) > 4096
                    {
                        return Err(Error::Invalid("invalid or oversized PNG".into()));
                    }
                }
                Block::RecordedAudio { wav, .. } => {
                    if wav.len() < 44
                        || wav.len() > 12_000_000
                        || wav[..4] != *b"RIFF"
                        || wav[8..12] != *b"WAVE"
                    {
                        return Err(Error::Invalid("invalid or oversized WAV".into()));
                    }
                }
                Block::SourceText { text, .. }
                    if text.trim().is_empty() || text.len() > 100_000 =>
                {
                    return Err(Error::Invalid("invalid source text".into()));
                }
                Block::Audio { speech }
                | Block::Example {
                    speech: Some(speech),
                    ..
                } => kind_of(speech, "speech")?,
                Block::Reference { target, .. } => kind_of(target, "material")?,
                Block::Table { columns, rows, .. }
                    if pack.schema_version.get() < 2
                        || !(2..=12).contains(&columns.len())
                        || !(1..=100).contains(&rows.len())
                        || rows.iter().any(|row| row.len() != columns.len()) =>
                {
                    return Err(Error::Invalid(
                        "tables require schema 2, 2–12 columns and 1–100 complete rows".into(),
                    ));
                }
                _ => {}
            }
        }
    }
    for speech in &pack.speech {
        if speech.text.trim().is_empty()
            || speech.text.len() > 6000
            || speech
                .pronunciation_override
                .as_ref()
                .is_some_and(|s| s.len() > 6000)
        {
            return Err(Error::Invalid("empty or oversized speech segment".into()));
        }
    }
    for rubric in &pack.rubrics {
        if rubric.criteria.is_empty() || rubric.criteria.len() > 30 {
            return Err(Error::Invalid("rubric must have 1–30 criteria".into()));
        }
        for reference in &rubric.model_answers {
            kind_of(reference, "material")?;
        }
    }
    for sense in &pack.vocabulary {
        for reference in &sense.examples {
            kind_of(reference, "material")?;
        }
    }
    for unit in &pack.course.units {
        kind_of(unit, "unit")?;
    }
    for unit in &pack.units {
        for reference in &unit.objectives {
            kind_of(reference, "objective")?;
        }
        if unit.lessons.is_empty() {
            return Err(Error::Invalid("empty unit".into()));
        }
        for lesson in &unit.lessons {
            kind_of(lesson, "lesson")?;
        }
        if let Some(assessment) = &unit.assessment {
            kind_of(assessment, "assessment")?;
        }
    }
    for lesson in &pack.lessons {
        for reference in &lesson.objectives {
            kind_of(reference, "objective")?;
        }
        if lesson.activities.is_empty() || lesson.activities.len() > 200 {
            return Err(Error::Invalid("lesson must have 1–200 activities".into()));
        }
        for activity in &lesson.activities {
            kind_of(activity, "activity")?;
            if activities
                .get(&activity.id)
                .is_some_and(|a| !a.usage.is_practice())
            {
                return Err(Error::Invalid(
                    "lesson cannot contain assessment items".into(),
                ));
            }
        }
    }
    for activity in &pack.activities {
        activity.validate().map_err(Error::Invalid)?;
        for objective in &activity.objectives {
            kind_of(objective, "objective")?;
        }
        for material in activity.materials.iter().chain(&activity.hints) {
            kind_of(material, "material")?;
        }
        match &activity.task {
            Task::Explanation { material } => kind_of(material, "material")?,
            Task::Choice { explanation, .. }
            | Task::Order { explanation, .. }
            | Task::ShortAnswer { explanation, .. } => kind_of(explanation, "material")?,
            Task::Writing { rubric, .. } | Task::Speaking { rubric, .. } => {
                kind_of(rubric, "rubric")?
            }
        }
        if let Task::ShortAnswer { mistakes, .. } = &activity.task {
            for mistake in mistakes {
                kind_of(&mistake.feedback, "material")?;
            }
        }
        if let Task::Speaking {
            keyboard_alternative,
            ..
        } = &activity.task
        {
            kind_of(keyboard_alternative, "activity")?;
            if activities
                .get(&keyboard_alternative.id)
                .is_none_or(|a| !matches!(a.task, Task::Writing { .. }))
            {
                return Err(Error::Invalid(
                    "speaking alternative must be a writing task".into(),
                ));
            }
        }
    }
    for assessment in &pack.assessments {
        if assessment.activities.is_empty() || assessment.activities.len() > 100 {
            return Err(Error::Invalid(
                "assessment must have 1–100 activities".into(),
            ));
        }
        for r in &assessment.activities {
            kind_of(r, "activity")?;
            let activity = activities
                .get(&r.id)
                .ok_or_else(|| Error::Invalid("assessment activity missing".into()))?;
            if !matches!(activity.usage, ActivityUse::Assessment)
                || matches!(activity.task, Task::Explanation { .. })
            {
                return Err(Error::Invalid(
                    "assessment uses a practice/explanation activity".into(),
                ));
            }
            for reference in &activity.materials {
                if pack.materials.iter().any(|material| {
                    material.content == *reference
                        && material
                            .blocks
                            .iter()
                            .any(|block| matches!(block, Block::RecordedAudio { .. }))
                }) {
                    return Err(Error::Invalid("recorded assessment audio needs native replay controls; use a speech segment".into()));
                }
            }
        }
    }
    connected::validate_connected(pack, &all)?;
    // Kahn's algorithm avoids recursion depth limits on large prerequisite graphs.
    let mut degrees: BTreeMap<_, usize> = pack
        .objectives
        .iter()
        .map(|o| (&o.content.id, o.prerequisites.len()))
        .collect();
    let mut children: BTreeMap<&Id, Vec<&Id>> = BTreeMap::new();
    for objective in &pack.objectives {
        for parent in &objective.prerequisites {
            children
                .entry(&parent.id)
                .or_default()
                .push(&objective.content.id);
        }
    }
    let mut ready: Vec<_> = degrees
        .iter()
        .filter_map(|(id, count)| (*count == 0).then_some(*id))
        .collect();
    let mut visited = 0;
    while let Some(id) = ready.pop() {
        visited += 1;
        if let Some(children) = children.get(id) {
            for child in children {
                let remaining = degrees
                    .get_mut(child)
                    .ok_or_else(|| Error::Invalid("missing prerequisite".into()))?;
                *remaining -= 1;
                if *remaining == 0 {
                    ready.push(child);
                }
            }
        }
    }
    if visited != pack.objectives.len() {
        return Err(Error::Invalid("objective prerequisite cycle".into()));
    }
    Ok(())
}

fn validate_text(value: &Value, locale: SourceLanguage) -> Result<()> {
    match value {
        Value::Object(object) => {
            if let (Some(language), Some(text)) = (object.get("language"), object.get("text"))
                && (!text.is_string()
                    || text
                        .as_str()
                        .is_none_or(|s| s.trim().is_empty() || s.len() > 100_000)
                    || (language != "es"
                        && language != locale.code()
                        && object.get("kind").and_then(Value::as_str) != Some("source_text")))
            {
                return Err(Error::Invalid(
                    "empty, oversized, or wrong-language text".into(),
                ));
            }
            for child in object.values() {
                validate_text(child, locale)?;
            }
        }
        Value::Array(items) => {
            for child in items {
                validate_text(child, locale)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn resolve(
    value: &mut Value,
    locale: SourceLanguage,
    translations: &BTreeMap<String, String>,
) -> Result<()> {
    match value {
        Value::Object(object)
            if object.len() == 2 && object.contains_key("de") && object.contains_key("en") =>
        {
            let text = object
                .get(locale.code())
                .and_then(Value::as_str)
                .ok_or_else(|| Error::Invalid("invalid bilingual teaching text".into()))?
                .to_owned();
            *value = serde_json::json!({"language": locale.code(), "text": text});
        }
        Value::Object(object) if object.len() == 1 && object.contains_key("slot") => {
            let key = object["slot"]
                .as_str()
                .ok_or_else(|| Error::Invalid("invalid text slot".into()))?;
            let text = translations.get(key).ok_or_else(|| {
                Error::Invalid(format!("missing {} translation: {key}", locale.code()))
            })?;
            *value = serde_json::json!({"language":locale.code(), "text":text});
        }
        Value::Object(object) => {
            for child in object.values_mut() {
                resolve(child, locale, translations)?;
            }
        }
        Value::Array(items) => {
            for child in items {
                resolve(child, locale, translations)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn compile_source(source: &Path, output: &Path) -> Result<Vec<PathBuf>> {
    fs::create_dir_all(output)?;
    let mut files: Vec<_> =
        fs::read_dir(source.join("shared"))?.collect::<std::io::Result<Vec<_>>>()?;
    files.sort_by_key(|x| x.file_name());
    let mut written = Vec::new();
    for locale in [SourceLanguage::De, SourceLanguage::En] {
        let translations: BTreeMap<String, String> = serde_json::from_slice(&fs::read(
            source
                .join("locales")
                .join(format!("{}.json", locale.code())),
        )?)?;
        for file in &files {
            let mut value: Value = if file.path().is_dir() {
                let mut course: Value =
                    serde_json::from_slice(&fs::read(file.path().join("course.json"))?)?;
                for folder in ["grammar", "lessons", "assessments", "missions"] {
                    let folder = file.path().join(folder);
                    if !folder.is_dir() {
                        continue;
                    }
                    let mut parts = fs::read_dir(folder)?.collect::<std::io::Result<Vec<_>>>()?;
                    parts.sort_by_key(|p| p.file_name());
                    for part in parts {
                        if part.path().extension().is_none_or(|p| p != "json") {
                            continue;
                        }
                        let fragment: Value = serde_json::from_slice(&fs::read(part.path())?)?;
                        let object = fragment.as_object().ok_or_else(|| {
                            Error::Invalid("course fragment must be an object".into())
                        })?;
                        for (key, items) in object {
                            if ![
                                "lessons",
                                "objectives",
                                "activities",
                                "materials",
                                "speech",
                                "vocabulary",
                                "rubrics",
                                "assessments",
                                "grammar",
                                "topics",
                                "missions",
                                "occurrences",
                            ]
                            .contains(&key.as_str())
                            {
                                return Err(Error::Invalid(format!(
                                    "unknown fragment field {key}"
                                )));
                            }
                            let items = items.as_array().ok_or_else(|| {
                                Error::Invalid("fragment fields must be arrays".into())
                            })?;
                            if course.get(key).is_none() {
                                course[key] = serde_json::json!([]);
                            }
                            course[key]
                                .as_array_mut()
                                .ok_or_else(|| {
                                    Error::Invalid(format!("missing course array {key}"))
                                })?
                                .extend(items.iter().cloned());
                        }
                    }
                }
                course
            } else {
                if file.path().extension().is_none_or(|x| x != "json") {
                    continue;
                }
                serde_json::from_slice(&fs::read(file.path())?)?
            };
            if value.get("missions").is_some() {
                value["schema_version"] = serde_json::json!(4);
            }
            resolve(&mut value, locale, &translations)?;
            value["course"]["source_language"] = serde_json::json!(locale);
            let mut pack: CoursePack = serde_json::from_value(value)?;
            validate(&pack)?;
            let mut fingerprint = Sha256::new();
            fingerprint.update(b"fluenta-content-compiler:7\n");
            fingerprint.update(serde_json::to_vec(&pack)?);
            let hash = format!("{:x}", fingerprint.finalize());
            pack.release_id = format!(
                "foundation.{}.{:?}.{}",
                locale.code(),
                pack.course.band,
                &hash[..16]
            )
            .try_into()
            .map_err(Error::Invalid)?;
            let path = output.join(format!("{}.sqlite", pack.release_id));
            write_pack(&pack, &path)?;
            written.push(path);
        }
    }
    let catalog = Catalog::open(output)?;
    for path in &written {
        let pack = catalog
            .packs
            .iter()
            .find(|p| p.path == *path)
            .ok_or_else(|| Error::Invalid("compiled pack missing".into()))?;
        let topics = catalog.grammar(pack.course.source_language)?;
        for objective in catalog.list::<Objective>(&pack.release_id, "objective")? {
            if objective
                .grammar_topics
                .iter()
                .any(|id| !topics.iter().any(|t| t.content.id == *id))
            {
                return Err(Error::Invalid("unknown linked grammar topic".into()));
            }
        }
    }
    fs::write(
        output.join("active-releases.json"),
        serde_json::to_vec_pretty(
            &written
                .iter()
                .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
                .collect::<Vec<_>>(),
        )?,
    )?;
    Ok(written)
}

pub fn plain_text(value: &Value) -> String {
    let mut fragments = Vec::new();
    fn walk(value: &Value, fragments: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                if let Some(text) = map.get("text").and_then(Value::as_str) {
                    fragments.push(text.to_owned());
                }
                for (key, child) in map {
                    if key != "text" {
                        walk(child, fragments);
                    }
                }
            }
            Value::Array(items) => {
                for child in items {
                    walk(child, fragments);
                }
            }
            _ => {}
        }
    }
    walk(value, &mut fragments);
    fragments.join(" ")
}

pub fn write_pack(pack: &CoursePack, path: &Path) -> Result<()> {
    validate(pack)?;
    let staged = tempfile::NamedTempFile::new_in(path.parent().unwrap_or(Path::new(".")))?;
    let mut db = Connection::open(staged.path())?;
    db.execute_batch(include_str!("schema.sql"))?;
    let tx = db.transaction()?;
    tx.execute("INSERT INTO metadata(key,value) VALUES('course',?1),('release_id',?2),('schema_version',?3)", params![serde_json::to_string(&pack.course)?, pack.release_id.as_str(), pack.schema_version.to_string()])?;
    let all = records(pack)?;
    let lessons: BTreeMap<_, _> = pack.lessons.iter().map(|l| (&l.content.id, l)).collect();
    let activities: BTreeMap<_, _> = pack.activities.iter().map(|a| (&a.content.id, a)).collect();
    for unit in &pack.units {
        let overview = UnitOverview {
            content: unit.content.clone(),
            title: unit.title.clone(),
            band: pack.course.band,
            assessment: unit.assessment.clone(),
            lessons: unit
                .lessons
                .iter()
                .map(|r| {
                    let lesson = lessons[&r.id];
                    let skills = lesson
                        .activities
                        .iter()
                        .flat_map(|a| &activities[&a.id].skills)
                        .map(|s| serde_json::to_string(s).map(|s| s.trim_matches('"').to_owned()))
                        .collect::<std::result::Result<BTreeSet<_>, _>>()?;
                    Ok(LessonOverview {
                        content: lesson.content.clone(),
                        title: lesson.title.clone(),
                        objectives: lesson.objectives.clone(),
                        estimated_minutes: lesson.estimated_minutes.get(),
                        activity_count: lesson.activities.len() as u32,
                        completed: false,
                        skills: skills.into_iter().collect(),
                    })
                })
                .collect::<Result<Vec<_>>>()?,
        };
        tx.execute(
            "INSERT INTO unit_overviews(unit_id,payload) VALUES(?1,?2)",
            params![unit.content.id.as_str(), serde_json::to_string(&overview)?],
        )?;
    }
    for (kind, value) in &all {
        let r: ContentRef = serde_json::from_value(value["content"].clone())?;
        tx.execute(
            "INSERT INTO entities(id,revision,kind,payload) VALUES(?1,?2,?3,?4)",
            params![
                r.id.as_str(),
                r.revision.get(),
                kind,
                serde_json::to_string(value)?
            ],
        )?;
        if (*kind == "material" && value["searchable"] == true)
            || ["vocabulary", "objective", "lesson"].contains(kind)
        {
            tx.execute(
                "INSERT INTO search(id,revision,kind,text) VALUES(?1,?2,?3,?4)",
                params![r.id.as_str(), r.revision.get(), kind, plain_text(value)],
            )?;
        }
    }
    for (_, value) in &all {
        let from: ContentRef = serde_json::from_value(value["content"].clone())?;
        let mut refs = Vec::new();
        references(value, &mut refs)?;
        for (index, to) in refs.iter().enumerate() {
            tx.execute("INSERT INTO relations(source_id,source_revision,position,target_id,target_revision) VALUES(?1,?2,?3,?4,?5)", params![from.id.as_str(),from.revision.get(),index as i64,to.id.as_str(),to.revision.get()])?;
        }
    }
    tx.commit()?;
    db.execute_batch("PRAGMA optimize; VACUUM;")?;
    drop(db);
    staged.persist(path).map_err(|e| e.error)?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct PackInfo {
    pub path: PathBuf,
    pub course: Course,
    pub release_id: Id,
    pub active: bool,
}

pub struct Catalog {
    pub packs: Vec<PackInfo>,
}
impl Catalog {
    pub fn grammar(&self, locale: SourceLanguage) -> Result<Vec<GrammarTopic>> {
        let mut result = Vec::new();
        for pack in self
            .packs
            .iter()
            .filter(|p| p.active && p.course.source_language == locale)
        {
            result.extend(self.list::<GrammarTopic>(&pack.release_id, "grammar")?);
        }
        Ok(result)
    }

    pub fn grammar_help(&self, release: &Id, activity: &ContentRef) -> Result<Vec<Material>> {
        let activity: Activity = self.get(release, activity, "activity")?;
        let mut seen = BTreeSet::new();
        let mut result = Vec::new();
        for objective in &activity.objectives {
            let objective: Objective = self.get(release, objective, "objective")?;
            for topic_id in &objective.grammar_topics {
                let locale = self.pack(release)?.course.source_language;
                let topic = self
                    .grammar(locale)?
                    .into_iter()
                    .find(|t| t.content.id == *topic_id)
                    .ok_or_else(|| Error::NotFound(topic_id.to_string()))?;
                for reference in topic.explanations {
                    if seen.insert((reference.id.clone(), reference.revision)) {
                        let pack = self.locate(locale, &reference)?;
                        result.push(self.get(&pack.release_id, &reference, "material")?);
                    }
                }
            }
            for reference in &objective.explanation_refs {
                if seen.insert((reference.id.clone(), reference.revision)) {
                    result.push(self.get(release, reference, "material")?);
                }
            }
        }
        Ok(result)
    }
    pub fn practice_activities(
        &self,
        release: &Id,
        objective: &ContentRef,
        skill: Option<Skill>,
    ) -> Result<Vec<ContentRef>> {
        let db = open_readonly(&self.pack(release)?.path)?;
        let skill = skill
            .map(|s| serde_json::to_string(&s).map(|v| v.trim_matches('"').to_owned()))
            .transpose()?;
        let mut query=db.prepare("SELECT DISTINCT e.id,e.revision FROM relations r JOIN entities e ON e.id=r.source_id AND e.revision=r.source_revision WHERE r.target_id=?1 AND r.target_revision=?2 AND e.kind='activity' AND COALESCE(json_extract(e.payload,'$.usage'),'practice')='practice' AND json_extract(e.payload,'$.task.kind')<>'explanation' AND (?3 IS NULL OR EXISTS(SELECT 1 FROM json_each(e.payload,'$.skills') WHERE value=?3)) ORDER BY random() LIMIT 15")?;
        query
            .query_map(
                params![objective.id.as_str(), objective.revision.get(), skill],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?)),
            )?
            .map(|r| {
                let (id, revision) = r?;
                Ok(ContentRef {
                    id: id.try_into().map_err(Error::Invalid)?,
                    revision: revision
                        .try_into()
                        .map_err(|_| Error::Invalid("zero revision".into()))?,
                })
            })
            .collect()
    }
    pub fn related_references(
        &self,
        locale: SourceLanguage,
        question: &str,
    ) -> Result<Vec<SearchHit>> {
        // Natural questions rarely match a full AND search. Rank a small set of
        // meaningful terms; only searchable, authored material can be returned.
        let stop = [
            "the",
            "and",
            "for",
            "this",
            "that",
            "with",
            "what",
            "please",
            "explain",
            "correct",
            "sentence",
            "how",
            "why",
            "ist",
            "die",
            "der",
            "das",
            "und",
            "eine",
            "einer",
            "einem",
            "einen",
            "eines",
            "ein",
            "mit",
            "auf",
            "was",
            "wie",
            "bitte",
            "kurz",
            "grammatik",
            "korrekt",
            "frase",
            "que",
            "los",
            "las",
            "una",
            "por",
            "para",
            "del",
            "explica",
            "explícame",
            "con",
            "entre",
            "ejemplo",
            "diferencia",
            "escolar",
            "español",
            "spanish",
            "spanisch",
            "erkläre",
            "unterschied",
            "zwischen",
        ];
        let terms: BTreeSet<_> = question
            .split(|c: char| !c.is_alphanumeric())
            .map(str::to_lowercase)
            .filter(|s| s.len() > 2 && !stop.contains(&s.as_str()))
            .take(12)
            .collect();
        let mut hits = BTreeMap::new();
        for term in terms {
            for hit in self.search(locale, &term)? {
                let score = 1 + usize::from(hit.title.text.to_lowercase().contains(&term));
                let entry = hits.entry(hit.content.id.clone()).or_insert((0, hit));
                entry.0 += score;
            }
        }
        let mut hits: Vec<_> = hits.into_values().collect();
        hits.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| a.1.content.id.cmp(&b.1.content.id))
        });
        hits.into_iter()
            .take(3)
            .map(|(_, mut hit)| {
                let pack = self.locate(locale, &hit.content)?;
                let material: Material = self.get(&pack.release_id, &hit.content, "material")?;
                hit.excerpt.text = plain_text(&serde_json::to_value(material)?)
                    .chars()
                    .take(1200)
                    .collect();
                Ok(hit)
            })
            .collect()
    }
    pub fn unit_overviews(&self, locale: SourceLanguage) -> Result<Vec<UnitOverview>> {
        let mut result = Vec::new();
        let mut seen = BTreeSet::new();
        for pack in self
            .packs
            .iter()
            .rev()
            .filter(|p| p.active && p.course.source_language == locale)
        {
            let db = open_readonly(&pack.path)?;
            let mut statement = db.prepare("SELECT payload FROM unit_overviews ORDER BY rowid")?;
            for value in statement.query_map([], |r| r.get::<_, String>(0))? {
                let unit: UnitOverview = serde_json::from_str(&value?)?;
                if seen.insert(unit.content.id.clone()) {
                    result.push(unit);
                }
            }
        }
        result.sort_by_key(|u| {
            (
                match u.band {
                    Band::A1 => 0,
                    Band::A2 => 1,
                    Band::B1 => 2,
                    Band::B2 => 3,
                },
                u.content.id.clone(),
            )
        });
        Ok(result)
    }
    pub fn open(directory: &Path) -> Result<Self> {
        let mut packs = Vec::new();
        for file in fs::read_dir(directory)? {
            let path = file?.path();
            if path.extension().is_none_or(|x| x != "sqlite") {
                continue;
            }
            let db = open_readonly(&path)?;
            let version: String = db.query_row(
                "SELECT value FROM metadata WHERE key='schema_version'",
                [],
                |r| r.get(0),
            )?;
            if !matches!(version.as_str(), "1" | "2" | "3" | "4") {
                return Err(Error::Invalid(
                    "unsupported installed content schema".into(),
                ));
            }
            let course =
                db.query_row("SELECT value FROM metadata WHERE key='course'", [], |r| {
                    r.get::<_, String>(0)
                })?;
            let release: String = db.query_row(
                "SELECT value FROM metadata WHERE key='release_id'",
                [],
                |r| r.get(0),
            )?;
            packs.push(PackInfo {
                path,
                course: serde_json::from_str(&course)?,
                release_id: release.try_into().map_err(Error::Invalid)?,
                active: true,
            });
        }
        packs.sort_by_key(|p| p.release_id.to_string());
        Ok(Self { packs })
    }

    pub fn pack(&self, release: &Id) -> Result<&PackInfo> {
        self.packs
            .iter()
            .find(|p| p.release_id == *release)
            .ok_or_else(|| Error::NotFound(release.to_string()))
    }
    pub fn locate(&self, locale: SourceLanguage, content: &ContentRef) -> Result<&PackInfo> {
        for pack in self
            .packs
            .iter()
            .rev()
            .filter(|p| p.active && p.course.source_language == locale)
            .chain(
                self.packs
                    .iter()
                    .rev()
                    .filter(|p| !p.active && p.course.source_language == locale),
            )
        {
            let found: bool = open_readonly(&pack.path)?.query_row(
                "SELECT EXISTS(SELECT 1 FROM entities WHERE id=?1 AND revision=?2)",
                params![content.id.as_str(), content.revision.get()],
                |r| r.get(0),
            )?;
            if found {
                return Ok(pack);
            }
        }
        Err(Error::NotFound(content.id.to_string()))
    }
    pub fn get<T: DeserializeOwned>(
        &self,
        release: &Id,
        content: &ContentRef,
        kind: &str,
    ) -> Result<T> {
        let db = open_readonly(&self.pack(release)?.path)?;
        let text: Option<String> = db
            .query_row(
                "SELECT payload FROM entities WHERE id=?1 AND revision=?2 AND kind=?3",
                params![content.id.as_str(), content.revision.get(), kind],
                |r| r.get(0),
            )
            .optional()?;
        serde_json::from_str(&text.ok_or_else(|| Error::NotFound(content.id.to_string()))?)
            .map_err(Error::from)
    }
    pub fn list<T: DeserializeOwned>(&self, release: &Id, kind: &str) -> Result<Vec<T>> {
        let db = open_readonly(&self.pack(release)?.path)?;
        let mut query = db.prepare("SELECT payload FROM entities WHERE kind=?1 ORDER BY rowid")?;
        let rows = query.query_map([kind], |r| r.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }
    pub fn search(&self, locale: SourceLanguage, query: &str) -> Result<Vec<SearchHit>> {
        Ok(self.search_page(locale, query, None)?.0)
    }
    pub fn activity_view(
        &self,
        release: &Id,
        activity: &Activity,
        hints_used: usize,
    ) -> Result<ActivityView> {
        let mut visible_materials = activity
            .materials
            .iter()
            .map(|r| self.get(release, r, "material"))
            .collect::<Result<Vec<Material>>>()?;
        if let Task::Explanation { material } = &activity.task {
            visible_materials.push(self.get(release, material, "material")?);
        }
        for r in activity.hints.iter().take(hints_used) {
            visible_materials.push(self.get(release, r, "material")?);
        }
        Ok(ActivityView {
            content: activity.content.clone(),
            instruction: activity.instruction.clone(),
            visible_materials,
            hints_remaining: activity.hints.len().saturating_sub(hints_used) as u32,
            task: TaskView::from(&activity.task),
        })
    }
}

fn open_readonly(path: &Path) -> Result<Connection> {
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    db.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;")?;
    Ok(db)
}
