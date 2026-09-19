use super::*;
use crate::sessions::{SessionPlan, ordinary_policy};
use serde_json::Value;

fn wire(value: &impl serde::Serialize) -> Result<String> {
    Ok(json(value)?.trim_matches('"').to_owned())
}
fn has_reference(value: &Value, reference: &ContentRef) -> bool {
    match value {
        Value::Object(o) => {
            (o.get("id").and_then(Value::as_str) == Some(reference.id.as_str())
                && o.get("revision").and_then(Value::as_u64)
                    == Some(u64::from(reference.revision.get())))
                || o.values().any(|v| has_reference(v, reference))
        }
        Value::Array(a) => a.iter().any(|v| has_reference(v, reference)),
        _ => false,
    }
}

pub(crate) fn record_evidence(
    db: &Connection,
    attempt: &Id,
    activity: &Activity,
    answer: &Answer,
    feedback: &Feedback,
    locale: SourceLanguage,
) -> Result<()> {
    let skill = match (&activity.task, answer) {
        (Task::Writing { .. } | Task::Speaking { .. }, _) => "production",
        (_, Answer::Voice { .. }) => "speech",
        (
            Task::ShortAnswer {
                target: TextTarget::Orthography,
                ..
            },
            _,
        ) => "spelling",
        (Task::ShortAnswer { .. }, _) => "recall",
        _ => "understanding",
    };
    for target in &activity.lexical {
        db.execute("INSERT INTO lexical_evidence(attempt_id,sense_id,locale,occurrence_id,evidence,outcome,skill) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![attempt.as_str(),target.sense.id.as_str(),locale.code(),target.occurrence.id.as_str(),wire(&feedback.evidence)?,wire(&feedback.outcome)?,skill])?;
    }
    Ok(())
}

impl Store {
    pub fn speech_release(
        &self,
        catalog: &Catalog,
        segment: &ContentRef,
        context: Option<&MutationContext>,
        now: i64,
    ) -> Result<Id> {
        if let Some(context) = context {
            match self.reserve_audio(context, segment, now) {
                Ok(release) => return Ok(release),
                Err(Error::Policy(key)) if key == "speech.segment_unavailable" => {}
                Err(error) => return Err(error),
            }
            let release = self.snapshot(&context.session_id)?.release_id;
            for occurrence in catalog.list::<Occurrence>(&release, "occurrence")? {
                if occurrence.speech.as_ref() == Some(segment) {
                    return Ok(self
                        .occurrence(catalog, &occurrence.content, Some(context))?
                        .0);
                }
            }
            return Err(Error::Policy("speech.segment_unavailable".into()));
        }
        self.mark_assistance(None)?;
        let locale = self.settings()?.source_language;
        let release = catalog.locate(locale, segment)?.release_id.clone();
        for material in catalog.list::<Material>(&release, "material")? {
            if has_reference(&serde_json::to_value(&material)?, segment)
                && self.reference(catalog, locale, &material.content).is_ok()
            {
                return Ok(release);
            }
        }
        for occurrence in catalog.list::<Occurrence>(&release, "occurrence")? {
            if occurrence.speech.as_ref() == Some(segment)
                && self.reference(catalog, locale, &occurrence.owner).is_ok()
            {
                return Ok(release);
            }
        }
        Err(Error::Policy("speech.segment_unavailable".into()))
    }
    /// Public explanations, visible input, or feedback already earned by submitting.
    /// Guessing the ID of a rubric/model/held-out passage does not grant access.
    pub fn reference(
        &self,
        catalog: &Catalog,
        locale: SourceLanguage,
        content: &ContentRef,
    ) -> Result<Material> {
        self.mark_assistance(None)?;
        let pack = catalog.locate(locale, content)?;
        let material: Material = catalog.get(&pack.release_id, content, "material")?;
        if material.searchable {
            return Ok(material);
        }
        let mut stmt = self.db.prepare("SELECT ss.view_json,ss.feedback_json FROM session_steps ss JOIN sessions s ON s.id=ss.session_id WHERE s.source_language=?1 AND (s.mode!='test' OR s.status='completed') AND (ss.position<=s.current_index OR s.status='completed')")?;
        for row in stmt.query_map([locale.code()], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })? {
            let (view, feedback) = row?;
            if has_reference(&from_json(&view)?, content)
                || feedback
                    .map(|f| from_json::<Value>(&f).map(|v| has_reference(&v, content)))
                    .transpose()?
                    .unwrap_or(false)
            {
                return Ok(material);
            }
        }
        Err(Error::Policy("content.not_available".into()))
    }

    fn occurrence(
        &self,
        catalog: &Catalog,
        reference: &ContentRef,
        context: Option<&MutationContext>,
    ) -> Result<(Id, Occurrence, LexicalSense)> {
        self.mark_assistance(context)?;
        let locale = self.settings()?.source_language;
        let release = if let Some(context) = context {
            self.snapshot(&context.session_id)?.release_id
        } else {
            catalog.locate(locale, reference)?.release_id.clone()
        };
        let occurrence: Occurrence = catalog.get(&release, reference, "occurrence")?;
        if let Some(context) = context {
            let snapshot = self.snapshot(&context.session_id)?;
            let SessionState::Active { step } = snapshot.session else {
                return Err(Error::Conflict);
            };
            let mut visible = has_reference(&serde_json::to_value(&step.activity)?, reference);
            if let Some(feedback) = step.feedback {
                visible |= has_reference(&serde_json::to_value(feedback)?, reference);
            }
            if !visible {
                return Err(Error::Policy("content.not_available".into()));
            }
        } else {
            // An occurrence in a private exercise can only be looked up in that exercise.
            self.reference(catalog, locale, &occurrence.owner)?;
        }
        let sense = catalog.get(&release, &occurrence.sense, "vocabulary")?;
        Ok((release, occurrence, sense))
    }

    fn encounter(
        &self,
        release: &Id,
        occurrence: &Occurrence,
        sense: &LexicalSense,
        learn: bool,
        now: i64,
    ) -> Result<()> {
        let locale = self.settings()?.source_language;
        self.db.execute("INSERT INTO vocabulary(sense_id,locale,release_id,sense_json,status,created_ms,updated_ms) VALUES(?1,?2,?3,?4,?5,?6,?6) ON CONFLICT(sense_id,locale) DO UPDATE SET release_id=excluded.release_id,sense_json=excluded.sense_json,status=CASE WHEN ?7 THEN 'active' ELSE vocabulary.status END,updated_ms=excluded.updated_ms",params![sense.content.id.as_str(),locale.code(),release.as_str(),json(sense)?,if learn {"active"} else {"recent"},now,learn])?;
        self.db.execute("INSERT INTO vocabulary_contexts(sense_id,locale,occurrence_id,occurrence_json,encountered_ms) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(sense_id,locale,occurrence_id) DO UPDATE SET occurrence_json=excluded.occurrence_json,encountered_ms=excluded.encountered_ms",params![sense.content.id.as_str(),locale.code(),occurrence.content.id.as_str(),json(occurrence)?,now])?;
        Ok(())
    }

    fn word_view(&self, sense: LexicalSense, extra: Option<Occurrence>) -> Result<WordView> {
        let locale = self.settings()?.source_language;
        let row: Option<(String, String)> = self
            .db
            .query_row(
                "SELECT status,notes FROM vocabulary WHERE sense_id=?1 AND locale=?2",
                params![sense.content.id.as_str(), locale.code()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (status, notes) = row.unwrap_or_else(|| ("recent".into(), String::new()));
        let mut contexts:Vec<Occurrence>=self.db.prepare("SELECT occurrence_json FROM vocabulary_contexts WHERE sense_id=?1 AND locale=?2 ORDER BY encountered_ms DESC")?.query_map(params![sense.content.id.as_str(),locale.code()],|r|r.get::<_,String>(0))?.map(|r|from_json(&r?)).collect::<Result<_>>()?;
        if let Some(extra) = extra {
            contexts.retain(|c| c.content != extra.content);
            contexts.insert(0, extra);
        }
        let due: Option<i64> = self
            .db
            .query_row(
                "SELECT due_ms FROM reviews WHERE sense_id=?1 AND source_language=?2",
                params![sense.content.id.as_str(), locale.code()],
                |r| r.get(0),
            )
            .optional()?;
        let counts=self.db.query_row("SELECT coalesce(sum(skill='understanding' AND outcome='correct' AND evidence!='assisted_recall'),0),coalesce(sum(skill IN ('recall','spelling') AND outcome='correct' AND evidence='unaided_recall'),0),coalesce(sum(evidence='assisted_recall'),0),coalesce(sum(skill='speech' AND outcome='correct'),0),coalesce(sum(skill='production'),0),coalesce(sum(skill='spelling' AND outcome='correct' AND evidence='unaided_recall'),0) FROM lexical_evidence WHERE sense_id=?1 AND locale=?2",params![sense.content.id.as_str(),locale.code()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?)))?;
        Ok(WordView {
            sense,
            status: from_json(&format!("\"{status}\""))?,
            notes,
            contexts,
            due_ms: due.map(|n| n as f64),
            understanding: counts.0,
            independent_recall: counts.1,
            assisted_recall: counts.2,
            spoken_recognition: counts.3,
            productive_attempts: counts.4,
            spelling_recall: counts.5,
        })
    }

    fn words(&self) -> Result<Vec<WordView>> {
        let locale = self.settings()?.source_language;
        self.db.prepare("SELECT sense_json FROM vocabulary WHERE locale=?1 ORDER BY updated_ms DESC,sense_id")?.query_map([locale.code()],|r|r.get::<_,String>(0))?.map(|r|self.word_view(from_json(&r?)?,None)).collect()
    }

    pub fn daily_plan(&self, catalog: &Catalog, now: i64) -> Result<DailyPlan> {
        let settings = self.settings()?;
        let locale = settings.source_language;
        let interests: Vec<Id> = self
            .db
            .query_row(
                "SELECT value FROM settings WHERE key='topic_interests'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .map(|v| from_json(&v))
            .transpose()?
            .unwrap_or_default();
        let mut topics = Vec::new();
        for topic in catalog.connected_topics(locale)? {
            let pack = catalog.locate(locale, &topic.content)?;
            let mut missions = Vec::new();
            for r in &topic.missions {
                let mission: Mission = catalog.get(&pack.release_id, r, "mission")?;
                let lesson: Lesson = catalog.get(&pack.release_id, &mission.lesson, "lesson")?;
                let progress=self.db.query_row("SELECT EXISTS(SELECT 1 FROM mission_sessions m JOIN sessions s ON s.id=m.session_id WHERE mission_id=?1 AND s.source_language=?2 AND status='completed' AND support!='rehearsal'),EXISTS(SELECT 1 FROM mission_sessions m JOIN sessions s ON s.id=m.session_id WHERE mission_id=?1 AND s.source_language=?2 AND support='rehearsal'),EXISTS(SELECT 1 FROM mission_sessions m JOIN sessions s ON s.id=m.session_id WHERE mission_id=?1 AND s.source_language=?2 AND status='completed' AND support='rehearsal' AND unseen=1 AND EXISTS(SELECT 1 FROM attempts a WHERE a.session_id=s.id))",params![mission.content.id.as_str(),locale.code()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
                let resume:Option<String>=self.db.query_row("SELECT s.id FROM mission_sessions m JOIN sessions s ON s.id=m.session_id WHERE mission_id=?1 AND s.source_language=?2 AND status='active' ORDER BY updated_ms DESC LIMIT 1",params![mission.content.id.as_str(),locale.code()],|r|r.get(0)).optional()?;
                missions.push(MissionView {
                    mission,
                    completed: progress.0,
                    challenge_seen: progress.1,
                    unseen_completed: progress.2,
                    resume: resume
                        .map(|r| r.try_into().map_err(Error::Invalid))
                        .transpose()?,
                    minutes: lesson.estimated_minutes.get(),
                });
            }
            missions.sort_by_key(|m| m.mission.order);
            topics.push(TopicView { topic, missions });
        }
        topics.sort_by_key(|topic| topic.missions.first().map(|m| m.mission.order));
        let due:u32=self.db.query_row("SELECT count(*) FROM vocabulary v LEFT JOIN reviews r ON r.sense_id=v.sense_id AND r.source_language=v.locale WHERE v.locale=?1 AND v.status='active' AND (r.due_ms IS NULL OR r.due_ms<=?2)",params![locale.code(),now],|r|r.get(0))?;
        let review_limit = if settings.daily_minutes <= 10 { 3 } else { 6 };
        let mut candidates: Vec<_> = topics
            .iter()
            .flat_map(|t| t.missions.iter().map(move |m| (t, m)))
            .filter(|(_, m)| !m.completed || m.resume.is_some())
            .collect();
        let rank = |band: Band| match band {
            Band::A1 => 0,
            Band::A2 => 1,
            Band::B1 => 2,
            Band::B2 => 3,
        };
        candidates.sort_by_key(|(t, m)| {
            (
                m.resume.is_none(),
                rank(m.mission.band) > rank(settings.starting_band),
                !interests.contains(&t.topic.content.id),
                m.mission.order,
            )
        });
        let recommended = candidates.first().map(|(_, m)| (*m).clone());
        let independent_words=self.db.query_row("SELECT count(DISTINCT sense_id) FROM lexical_evidence WHERE locale=?1 AND evidence='unaided_recall' AND outcome='correct' AND skill IN ('recall','spelling')",[locale.code()],|r|r.get(0))?;
        let unseen_tasks = topics
            .iter()
            .flat_map(|t| &t.missions)
            .filter(|m| m.unseen_completed)
            .count() as u32;
        Ok(DailyPlan {
            recommended,
            topics,
            due,
            review_limit,
            new_word_limit: if due > review_limit * 3 {
                0
            } else if settings.daily_minutes <= 10 {
                3
            } else {
                5
            },
            minutes: settings.daily_minutes,
            interests,
            independent_words,
            unseen_tasks,
        })
    }

    fn start_mission(
        &mut self,
        catalog: &Catalog,
        reference: &ContentRef,
        support: SupportLevel,
        now: i64,
    ) -> Result<SessionSnapshot> {
        self.check_reference_access()?;
        let locale = self.settings()?.source_language;
        let release = catalog.locate(locale, reference)?.release_id.clone();
        let mission: Mission = catalog.get(&release, reference, "mission")?;
        let existing:Option<String>=self.db.query_row("SELECT s.id FROM sessions s JOIN mission_sessions m ON m.session_id=s.id WHERE mission_id=?1 AND support=?2 AND s.source_language=?3 AND status='active' ORDER BY updated_ms DESC LIMIT 1",params![reference.id.as_str(),wire(&support)?,locale.code()],|r|r.get(0)).optional()?;
        if let Some(id) = existing {
            return self.resume(&id.try_into().map_err(Error::Invalid)?, now);
        }
        let seen:bool=self.db.query_row("SELECT EXISTS(SELECT 1 FROM mission_sessions m JOIN sessions s ON s.id=m.session_id WHERE mission_id=?1 AND source_language=?2 AND support='rehearsal')",params![reference.id.as_str(),locale.code()],|r|r.get(0))?;
        let (mode, activities, policy) = if support == SupportLevel::Rehearsal {
            let assessment: Assessment = catalog.get(&release, &mission.challenge, "assessment")?;
            (
                SessionMode::Test,
                assessment.activities,
                SessionPolicy {
                    hints_allowed: false,
                    tutor_allowed: false,
                    reveal: RevealPolicy::AfterSession,
                    audio_replays: Some(assessment.audio_replays),
                    time_limit_seconds: Some(assessment.duration_seconds),
                },
            )
        } else {
            let lesson: Lesson = catalog.get(&release, &mission.lesson, "lesson")?;
            let activities = if support == SupportLevel::Independent {
                lesson
                    .activities
                    .into_iter()
                    .filter_map(
                        |r| match catalog.get::<Activity>(&release, &r, "activity") {
                            Ok(a) if !a.preparation => Some(Ok(r)),
                            Ok(_) => None,
                            Err(e) => Some(Err(Error::from(e))),
                        },
                    )
                    .collect::<Result<Vec<_>>>()?
            } else {
                lesson.activities
            };
            (SessionMode::Lesson, activities, ordinary_policy())
        };
        let mut activities = activities;
        if support == SupportLevel::Learn
            && let Ok(review) = self.word_review_plan(catalog, None, false, now)
            && review.release == release
        {
            let limit = if self.settings()?.daily_minutes <= 10 {
                1
            } else {
                3
            };
            let mut warmup: Vec<_> = review
                .activities
                .into_iter()
                .filter(|a| !activities.contains(a))
                .take(limit)
                .collect();
            warmup.append(&mut activities);
            activities = warmup;
        }
        let session = self.start_plan(
            catalog,
            SessionPlan {
                locale,
                mode,
                target: reference.clone(),
                release,
                activities,
                policy,
            },
            now,
        )?;
        self.db.execute("INSERT INTO mission_sessions(session_id,mission_id,support,unseen) VALUES(?1,?2,?3,?4)",params![session.session_id.as_str(),reference.id.as_str(),wire(&support)?,!seen && support==SupportLevel::Rehearsal])?;
        Ok(session)
    }

    fn word_review_plan(
        &self,
        catalog: &Catalog,
        sense: Option<ContentRef>,
        production: bool,
        now: i64,
    ) -> Result<SessionPlan> {
        self.check_reference_access()?;
        let locale = self.settings()?.source_language;
        let limit = if sense.is_some() {
            1
        } else if self.settings()?.daily_minutes <= 10 {
            3
        } else {
            6
        };
        let mut selected = Vec::new();
        let mut release = None;
        let words:Vec<String>=self.db.prepare("SELECT v.sense_json FROM vocabulary v LEFT JOIN reviews r ON r.sense_id=v.sense_id AND r.source_language=v.locale WHERE v.locale=?1 AND v.status='active' AND (?3 IS NULL OR v.sense_id=?3) AND (?3 IS NOT NULL OR r.due_ms IS NULL OR r.due_ms<=?2) ORDER BY coalesce(r.due_ms,0),v.created_ms")?.query_map(params![locale.code(),now,sense.as_ref().map(|s|s.id.as_str())],|r|r.get(0))?.collect::<std::result::Result<_,_>>()?;
        for stored in words {
            let stored: LexicalSense = from_json(&stored)?;
            let pack = catalog.locate(locale, &stored.content)?;
            if release.as_ref().is_some_and(|r| *r != pack.release_id) {
                continue;
            }
            let current: LexicalSense =
                catalog.get(&pack.release_id, &stored.content, "vocabulary")?;
            let mut choices = Vec::new();
            for reference in &current.practice {
                let activity: Activity = catalog.get(&pack.release_id, reference, "activity")?;
                let productive =
                    matches!(activity.task, Task::Writing { .. } | Task::Speaking { .. });
                if productive != production {
                    continue;
                }
                let attempts: u32 = self.db.query_row(
                    "SELECT count(*) FROM attempts WHERE activity_id=?1 AND source_language=?2",
                    params![reference.id.as_str(), locale.code()],
                    |r| r.get(0),
                )?;
                choices.push((attempts, reference.clone()));
            }
            choices.sort_by_key(|(n, _)| *n);
            if let Some((_, reference)) = choices.first() {
                selected.push(reference.clone());
                release = Some(pack.release_id.clone());
            }
            if selected.len() >= limit {
                break;
            }
        }
        let release = release.ok_or_else(|| Error::Invalid("review.none_due".into()))?;
        Ok(SessionPlan {
            locale,
            mode: SessionMode::Review,
            target: fluenta_content::reference("connected.words"),
            release,
            activities: selected,
            policy: ordinary_policy(),
        })
    }

    fn productions(&self, session: Option<&Id>) -> Result<Vec<ProductionRecord>> {
        self.check_reference_access()?;
        let locale = self.settings()?.source_language;
        let mut result = Vec::new();
        let mut stmt=self.db.prepare("SELECT s.id,ss.id,ss.view_json,a.answer_json,ss.feedback_json,a.created_ms,ss.assisted FROM attempts a JOIN session_steps ss ON ss.id=a.step_id JOIN sessions s ON s.id=a.session_id WHERE s.source_language=?1 AND a.outcome='needs_self_review' AND (?2 IS NULL OR s.id=?2) AND (s.mode!='test' OR s.status='completed') ORDER BY a.created_ms DESC LIMIT 100")?;
        for row in stmt.query_map(params![locale.code(), session.map(Id::as_str)], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, bool>(6)?,
            ))
        })? {
            let (session, step, activity, answer, feedback, created, assisted) = row?;
            let revisions=self.db.prepare("SELECT id,answer_json,criteria_json,created_ms FROM output_revisions WHERE step_id=?1 ORDER BY created_ms,id")?.query_map([&step],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?)))?.map(|r|{let(id,answer,criteria,ms)=r?;Ok(Revision{id:id.try_into().map_err(Error::Invalid)?,answer:from_json(&answer)?,criteria:from_json(&criteria)?,created_ms:ms as f64})}).collect::<Result<_>>()?;
            let version: u32 = self.db.query_row(
                "SELECT version FROM session_steps WHERE id=?1",
                [&step],
                |r| r.get(0),
            )?;
            let context = MutationContext {
                session_id: session.clone().try_into().map_err(Error::Invalid)?,
                step_id: step.clone().try_into().map_err(Error::Invalid)?,
                expected_step_version: version.try_into().map_err(|_| Error::Conflict)?,
            };
            result.push(ProductionRecord {
                context,
                session_id: session.try_into().map_err(Error::Invalid)?,
                step_id: step.try_into().map_err(Error::Invalid)?,
                activity: from_json(&activity)?,
                original: from_json(&answer)?,
                feedback: from_json(&feedback)?,
                revisions,
                created_ms: created as f64,
                assisted,
            });
        }
        Ok(result)
    }

    fn recap(&self, catalog: &Catalog, session: &Id) -> Result<MissionRecap> {
        self.check_reference_access()?;
        let snapshot = self.snapshot(session)?;
        if !matches!(snapshot.session, SessionState::Completed { .. }) {
            return Err(Error::Policy("session.not_complete".into()));
        }
        let mission: Option<String> = self
            .db
            .query_row(
                "SELECT mission_id FROM mission_sessions WHERE session_id=?1",
                [session.as_str()],
                |r| r.get(0),
            )
            .optional()?;
        let mission: Option<Mission> = mission
            .map(|id| {
                catalog.get(
                    &snapshot.release_id,
                    &fluenta_content::reference(&id),
                    "mission",
                )
            })
            .transpose()?;
        let mut suggestions = Vec::new();
        if let Some(mission) = &mission {
            for sense in &mission.vocabulary {
                let sense: LexicalSense = catalog.get(&snapshot.release_id, sense, "vocabulary")?;
                let occurrence = catalog
                    .list::<Occurrence>(&snapshot.release_id, "occurrence")?
                    .into_iter()
                    .find(|o| {
                        o.sense == sense.content
                            && self
                                .reference(catalog, snapshot.source_language, &o.owner)
                                .is_ok()
                    });
                if let Some(occurrence) = occurrence {
                    suggestions.push(self.word_view(sense, Some(occurrence))?);
                }
            }
        }
        Ok(MissionRecap {
            mission,
            suggestions,
            productions: self.productions(Some(session))?,
        })
    }

    fn notebook(&self) -> Result<Vec<NotebookEntry>> {
        let locale = self.settings()?.source_language;
        self.db.prepare("SELECT id,text,source_json,source_title,counterargument,created_ms FROM notebook WHERE locale=?1 ORDER BY updated_ms DESC")?.query_map([locale.code()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get(3)?,r.get(4)?,r.get::<_,i64>(5)?)))?.map(|r|{let(id,text,source,title,counterargument,created)=r?;Ok(NotebookEntry{id:id.try_into().map_err(Error::Invalid)?,text,source:from_json(&source)?,source_title:title,counterargument,created_ms:created as f64})}).collect()
    }

    pub fn connected(
        &mut self,
        catalog: &Catalog,
        command: ConnectedCommand,
        now: i64,
    ) -> Result<ConnectedResponse> {
        use ConnectedCommand::*;
        let locale = self.settings()?.source_language;
        Ok(match command {
            Today => ConnectedResponse::Today(self.daily_plan(catalog, now)?),
            Interests { topics } => {
                let available = catalog.connected_topics(locale)?;
                if topics.len() > 30
                    || topics
                        .iter()
                        .any(|id| !available.iter().any(|t| t.content.id == *id))
                {
                    return Err(Error::Invalid("content.not_found".into()));
                }
                self.db.execute("INSERT INTO settings(key,value) VALUES('topic_interests',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[json(&topics)?])?;
                ConnectedResponse::Today(self.daily_plan(catalog, now)?)
            }
            Words => {
                self.mark_assistance(None)?;
                ConnectedResponse::Words(self.words()?)
            }
            Lookup {
                occurrence,
                context,
                opened,
            } => {
                let (release, occurrence, sense) =
                    self.occurrence(catalog, &occurrence, context.as_ref())?;
                if opened {
                    self.encounter(&release, &occurrence, &sense, false, now)?;
                }
                ConnectedResponse::Word(Box::new(self.word_view(sense, Some(occurrence))?))
            }
            LearnWord {
                occurrence,
                context,
            } => {
                let (release, occurrence, sense) =
                    self.occurrence(catalog, &occurrence, context.as_ref())?;
                self.encounter(&release, &occurrence, &sense, true, now)?;
                ConnectedResponse::Word(Box::new(self.word_view(sense, Some(occurrence))?))
            }
            UpdateWord {
                sense,
                status,
                notes,
            } => {
                if notes.len() > 8000 {
                    return Err(Error::Invalid("answer.too_long".into()));
                }
                self.check_reference_access()?;
                if self.db.execute("UPDATE vocabulary SET status=?3,notes=?4,updated_ms=?5 WHERE sense_id=?1 AND locale=?2",params![sense.id.as_str(),locale.code(),wire(&status)?,notes,now])?!=1 {return Err(Error::NotFound);}
                ConnectedResponse::Accepted
            }
            StartMission { mission, support } => ConnectedResponse::Session(Box::new(
                self.start_mission(catalog, &mission, support, now)?,
            )),
            ReviewWords { sense, production } => {
                let plan = self.word_review_plan(catalog, sense, production, now)?;
                ConnectedResponse::Session(Box::new(self.start_plan(catalog, plan, now)?))
            }
            Recap { session_id } => ConnectedResponse::Recap(self.recap(catalog, &session_id)?),
            Productions => ConnectedResponse::Productions(self.productions(None)?),
            Revise {
                step_id,
                answer,
                criteria,
            } => {
                self.check_reference_access()?;
                let record = self
                    .productions(None)?
                    .into_iter()
                    .find(|p| p.step_id == step_id)
                    .ok_or(Error::NotFound)?;
                let rubric = record.feedback.rubric.as_ref().ok_or(Error::NotFound)?;
                if criteria
                    .keys()
                    .any(|id| !rubric.criteria.iter().any(|c| c.id == *id))
                {
                    return Err(Error::Invalid("answer.invalid".into()));
                }
                match &answer {
                    Answer::Writing { text } => {
                        let max = match record.activity.task {
                            TaskView::Writing { max_words, .. } => max_words.get() as usize,
                            _ => 1000,
                        };
                        if text.trim().is_empty()
                            || text.len() > 40_000
                            || text.split_whitespace().count() > max
                        {
                            return Err(Error::Invalid("answer.too_long".into()));
                        }
                    }
                    Answer::Recording { recording_id } => {
                        let valid:bool=self.db.query_row("SELECT EXISTS(SELECT 1 FROM recordings WHERE id=?1 AND session_id=?2 AND step_id=?3)",params![recording_id.as_str(),record.session_id.as_str(),step_id.as_str()],|r|r.get(0))?;
                        if !valid {
                            return Err(Error::Invalid("answer.recording_missing".into()));
                        }
                    }
                    _ => return Err(Error::Invalid("answer.invalid".into())),
                }
                self.db.execute("INSERT INTO output_revisions(id,step_id,answer_json,criteria_json,created_ms) VALUES(?1,?2,?3,?4,?5)",params![new_id().as_str(),step_id.as_str(),json(&answer)?,json(&criteria)?,now])?;
                ConnectedResponse::Productions(self.productions(None)?)
            }
            Notebook => {
                self.mark_assistance(None)?;
                ConnectedResponse::Notebook(self.notebook()?)
            }
            SaveArgument {
                id,
                source,
                text,
                counterargument,
            } => {
                self.mark_assistance(None)?;
                if text.trim().is_empty() || text.len() > 8000 || counterargument.len() > 8000 {
                    return Err(Error::Invalid("answer.too_long".into()));
                }
                let material = self.reference(catalog, locale, &source)?;
                let title = material
                    .blocks
                    .iter()
                    .find_map(|b| {
                        if let Block::Heading { spans } = b {
                            Some(
                                spans
                                    .iter()
                                    .map(|s| s.text.as_str())
                                    .collect::<Vec<_>>()
                                    .join(" "),
                            )
                        } else {
                            None
                        }
                    })
                    .unwrap_or_else(|| source.id.to_string());
                let id = id.unwrap_or_else(new_id);
                self.db.execute("INSERT INTO notebook(id,locale,source_json,source_title,text,counterargument,created_ms,updated_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,?7) ON CONFLICT(id) DO UPDATE SET text=excluded.text,counterargument=excluded.counterargument,updated_ms=excluded.updated_ms WHERE notebook.locale=excluded.locale",params![id.as_str(),locale.code(),json(&source)?,title,text,counterargument,now])?;
                ConnectedResponse::Notebook(self.notebook()?)
            }
            DeleteArgument { id } => {
                self.check_reference_access()?;
                self.db.execute(
                    "DELETE FROM notebook WHERE id=?1 AND locale=?2",
                    params![id.as_str(), locale.code()],
                )?;
                ConnectedResponse::Notebook(self.notebook()?)
            }
        })
    }
}
