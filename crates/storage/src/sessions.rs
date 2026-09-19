use super::*;
use fluenta_learning::{EvidenceContext, ReviewMemory, evaluate, schedule};
use rand::seq::SliceRandom;
use rusqlite::TransactionBehavior;
pub(crate) struct SessionPlan {
    pub locale: SourceLanguage,
    pub mode: SessionMode,
    pub target: ContentRef,
    pub release: Id,
    pub activities: Vec<ContentRef>,
    pub policy: SessionPolicy,
}

fn wire(value: &impl serde::Serialize) -> Result<String> {
    Ok(json(value)?.trim_matches('"').to_owned())
}
fn decode_enum<T: serde::de::DeserializeOwned>(value: &str) -> Result<T> {
    from_json(&format!("\"{value}\""))
}
fn context_check(snapshot: &SessionSnapshot, context: &MutationContext) -> Result<()> {
    let SessionState::Active { step } = &snapshot.session else {
        return Err(Error::Conflict);
    };
    if snapshot.session_id != context.session_id
        || step.step_id != context.step_id
        || step.version != context.expected_step_version
    {
        return Err(Error::Conflict);
    }
    Ok(())
}
fn existing_mutation(db: &Connection, id: &Id, request: &str) -> Result<Option<SessionSnapshot>> {
    let previous: Option<(String, String)> = db
        .query_row(
            "SELECT request_json,response_json FROM mutations WHERE id=?1",
            [id.as_str()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((stored, response)) = previous {
        if stored != request {
            return Err(Error::Invalid("request.id_reused".into()));
        }
        return Ok(Some(from_json(&response)?));
    }
    Ok(None)
}
fn save_mutation(
    db: &Connection,
    id: &Id,
    request: &str,
    snapshot: &SessionSnapshot,
) -> Result<()> {
    db.execute(
        "INSERT INTO mutations(id,request_json,response_json) VALUES(?1,?2,?3)",
        params![id.as_str(), request, json(snapshot)?],
    )?;
    Ok(())
}

fn read_snapshot(db: &Connection, id: &Id) -> Result<SessionSnapshot> {
    let header=db.query_row("SELECT source_language,release_id,mode,version,current_index,status,policy_json,deadline_ms FROM sessions WHERE id=?1",[id.as_str()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,u32>(3)?,r.get::<_,u32>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,Option<i64>>(7)?))).optional()?.ok_or(Error::NotFound)?;
    let (locale, release, mode, version, index, status, policy, deadline) = header;
    let mode: SessionMode = decode_enum(&mode)?;
    let policy: SessionPolicy = from_json(&policy)?;
    let count: u32 = db.query_row(
        "SELECT count(*) FROM session_steps WHERE session_id=?1",
        [id.as_str()],
        |r| r.get(0),
    )?;
    let session = match status.as_str() {
        "active" => {
            let row=db.query_row("SELECT id,version,phase,view_json,draft_json,draft_sequence,feedback_json,audio_plays FROM session_steps WHERE session_id=?1 AND position=?2",params![id.as_str(),index],|r|Ok((r.get::<_,String>(0)?,r.get::<_,u32>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,u32>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,u32>(7)?)))?;
            let (step_id, version, phase, view, draft, sequence, feedback, audio_plays) = row;
            let mut feedback: Option<Feedback> = feedback.map(|v| from_json(&v)).transpose()?;
            if matches!(mode, SessionMode::Test) && feedback.is_some() {
                feedback = Some(Feedback {
                    outcome: Outcome::DeferredUntilRecap,
                    evidence: Evidence::None,
                    message: None,
                    explanation: None,
                    rubric: None,
                });
            }
            SessionState::Active {
                step: Box::new(ActiveStep {
                    step_id: step_id.try_into().map_err(Error::Invalid)?,
                    version: version.try_into().map_err(|_| Error::Conflict)?,
                    index,
                    phase: decode_enum(&phase)?,
                    activity: from_json(&view)?,
                    draft: draft.map(|v| from_json(&v)).transpose()?,
                    draft_sequence: sequence,
                    audio_plays,
                    feedback,
                }),
            }
        }
        "completed" => SessionState::Completed {
            summary: summary(db, id)?,
        },
        "abandoned" => SessionState::Abandoned,
        _ => return Err(Error::Invalid("session.invalid_state".into())),
    };
    Ok(SessionSnapshot {
        session_id: id.clone(),
        source_language: decode_enum(&locale)?,
        mode,
        release_id: release.try_into().map_err(Error::Invalid)?,
        version: version.try_into().map_err(|_| Error::Conflict)?,
        step_count: count.try_into().map_err(|_| Error::Conflict)?,
        policy,
        session,
        deadline_ms: deadline.map(|v| v as f64),
    })
}

fn summary(db: &Connection, id: &Id) -> Result<SessionSummary> {
    let mut result = SessionSummary {
        completed_steps: 0,
        objectively_marked: 0,
        correct_unaided: 0,
        needs_review: Vec::new(),
    };
    let mut statement=db.prepare("SELECT activity_id,activity_revision,feedback_json FROM session_steps WHERE session_id=?1 ORDER BY position")?;
    for row in statement.query_map([id.as_str()], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, u32>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })? {
        let (activity, revision, feedback) = row?;
        if let Some(feedback) = feedback {
            let feedback: Feedback = from_json(&feedback)?;
            result.completed_steps += 1;
            if matches!(feedback.outcome, Outcome::Correct | Outcome::Incorrect) {
                result.objectively_marked += 1;
            }
            if matches!(feedback.outcome, Outcome::Correct)
                && !matches!(
                    feedback.evidence,
                    Evidence::AssistedRecall | Evidence::EditedTranscript
                )
            {
                result.correct_unaided += 1;
            }
            if !matches!(
                feedback.outcome,
                Outcome::Incorrect | Outcome::NeedsSelfReview
            ) {
                continue;
            }
        }
        result.needs_review.push(ContentRef {
            id: activity.try_into().map_err(Error::Invalid)?,
            revision: revision.try_into().map_err(|_| Error::Conflict)?,
        });
    }
    Ok(result)
}

impl Store {
    pub fn mark_assistance(&self, context: Option<&MutationContext>) -> Result<()> {
        self.check_reference_access()?;
        if let Some(context) = context {
            let snapshot = self.snapshot(&context.session_id)?;
            context_check(&snapshot, context)?;
            self.db.execute(
                "UPDATE session_steps SET assisted=1 WHERE id=?1 AND phase='answering'",
                [context.step_id.as_str()],
            )?;
        } else {
            self.db.execute(
                "UPDATE session_steps SET assisted=1 WHERE phase='answering'
                 AND EXISTS (SELECT 1 FROM sessions s WHERE s.id=session_steps.session_id
                   AND s.status='active' AND s.current_index=session_steps.position)",
                [],
            )?;
        }
        Ok(())
    }
    pub fn reserve_audio(
        &self,
        context: &MutationContext,
        segment: &ContentRef,
        now: i64,
    ) -> Result<Id> {
        let snapshot = self.snapshot(&context.session_id)?;
        context_check(&snapshot, context)?;
        if snapshot
            .deadline_ms
            .is_some_and(|deadline| now as f64 >= deadline)
        {
            return Err(Error::Policy("test.time_expired".into()));
        }
        let SessionState::Active { step } = &snapshot.session else {
            return Err(Error::Conflict);
        };
        let visible=step.activity.visible_materials.iter().flat_map(|m|&m.blocks).any(|b|matches!(b,Block::Audio{speech}|Block::Example{speech:Some(speech),..} if speech==segment));
        if !visible {
            return Err(Error::Policy("speech.segment_unavailable".into()));
        }
        if snapshot
            .policy
            .audio_replays
            .is_some_and(|replays| step.audio_plays >= replays.saturating_add(1))
        {
            return Err(Error::Policy("test.replays_exhausted".into()));
        }
        self.db.execute(
            "UPDATE session_steps SET audio_plays=audio_plays+1 WHERE id=?1",
            [context.step_id.as_str()],
        )?;
        Ok(snapshot.release_id)
    }
    pub fn refund_audio(&self, context: &MutationContext) -> Result<()> {
        self.db.execute("UPDATE session_steps SET audio_plays=max(0,audio_plays-1) WHERE id=?1 AND session_id=?2",params![context.step_id.as_str(),context.session_id.as_str()])?;
        Ok(())
    }
    pub fn keyboard_alternative(
        &self,
        catalog: &Catalog,
        context: &MutationContext,
    ) -> Result<SessionSnapshot> {
        let snapshot = self.snapshot(&context.session_id)?;
        context_check(&snapshot, context)?;
        let SessionState::Active { step } = &snapshot.session else {
            return Err(Error::Conflict);
        };
        if !matches!(step.phase, StepPhase::Answering) {
            return Err(Error::Conflict);
        }
        let TaskView::Speaking {
            keyboard_alternative,
            ..
        } = &step.activity.task
        else {
            return Err(Error::Invalid("speech.no_alternative".into()));
        };
        let activity: Activity =
            catalog.get(&snapshot.release_id, keyboard_alternative, "activity")?;
        if !matches!(activity.task, Task::Writing { .. }) {
            return Err(Error::Invalid("speech.invalid_alternative".into()));
        }
        let mut view = catalog.activity_view(&snapshot.release_id, &activity, 0)?;
        if !snapshot.policy.hints_allowed {
            view.hints_remaining = 0;
        }
        self.db.execute("UPDATE session_steps SET activity_id=?2,activity_revision=?3,view_json=?4,draft_json=NULL,draft_sequence=0,version=version+1 WHERE id=?1",params![context.step_id.as_str(),activity.content.id.as_str(),activity.content.revision.get(),json(&view)?])?;
        self.snapshot(&context.session_id)
    }
    pub fn snapshot(&self, id: &Id) -> Result<SessionSnapshot> {
        read_snapshot(&self.db, id)
    }
    pub fn resume(&self, id: &Id, now: i64) -> Result<SessionSnapshot> {
        self.db.execute("UPDATE sessions SET status='completed',version=version+1,updated_ms=?2 WHERE id=?1 AND status='active' AND deadline_ms IS NOT NULL AND deadline_ms<=?2",params![id.as_str(),now])?;
        self.db.execute(
            "UPDATE sessions SET updated_ms=?2 WHERE id=?1",
            params![id.as_str(), now],
        )?;
        self.snapshot(id)
    }
    pub fn abandon(&self, id: &Id, now: i64) -> Result<()> {
        self.db.execute("UPDATE sessions SET status='abandoned',version=version+1,updated_ms=?2 WHERE id=?1 AND status='active'",params![id.as_str(),now])?;
        Ok(())
    }
    /// Studio discards previous previews when rebuilding its isolated curriculum.
    pub fn abandon_active_sessions(&self, now: i64) -> Result<()> {
        self.db.execute("UPDATE sessions SET status='abandoned',version=version+1,updated_ms=?1 WHERE status='active'", [now])?;
        Ok(())
    }
    pub fn start_session(
        &mut self,
        catalog: &Catalog,
        locale: SourceLanguage,
        mode: SessionMode,
        target: &ContentRef,
        now: i64,
    ) -> Result<SessionSnapshot> {
        self.start_filtered_session(catalog, locale, mode, target, None, now)
    }
    pub fn start_filtered_session(
        &mut self,
        catalog: &Catalog,
        locale: SourceLanguage,
        mode: SessionMode,
        target: &ContentRef,
        skill: Option<Skill>,
        now: i64,
    ) -> Result<SessionSnapshot> {
        self.check_reference_access()?;
        if matches!(mode, SessionMode::Lesson) {
            let previous:Option<String>=self.db.query_row("SELECT id FROM sessions WHERE source_language=?1 AND target_id=?2 AND mode='lesson' AND status='active' ORDER BY updated_ms DESC LIMIT 1",params![locale.code(),target.id.as_str()],|r|r.get(0)).optional()?;
            if let Some(id) = previous {
                return self.resume(&id.try_into().map_err(Error::Invalid)?, now);
            }
        }
        let (release, activities, policy) = match mode {
            SessionMode::Review => {
                let mut due = Vec::new();
                for row in self.db.prepare("SELECT activity_id,revision FROM reviews WHERE (source_language=?1 OR source_language='es') AND sense_id IS NULL AND due_ms<=?2 ORDER BY due_ms LIMIT 100")?.query_map(params![locale.code(),now],|r|Ok((r.get::<_,String>(0)?,r.get::<_,u32>(1)?)))? {
                    let (id,revision)=row?;due.push(ContentRef{id:id.try_into().map_err(Error::Invalid)?,revision:revision.try_into().map_err(|_|Error::Conflict)?});
                }
                let first = due
                    .first()
                    .ok_or_else(|| Error::Invalid("review.none_due".into()))?;
                let pack = catalog.locate(locale, first)?;
                let mut selected = Vec::new();
                for r in due {
                    if catalog
                        .get::<Activity>(&pack.release_id, &r, "activity")
                        .is_ok()
                    {
                        selected.push(r);
                        if selected.len()
                            == if self.settings()?.daily_minutes <= 10 {
                                3
                            } else {
                                6
                            }
                        {
                            break;
                        }
                    }
                }
                (pack.release_id.clone(), selected, ordinary_policy())
            }
            SessionMode::Lesson => {
                let pack = catalog.locate(locale, target)?;
                let lesson: Lesson = catalog.get(&pack.release_id, target, "lesson")?;
                (
                    pack.release_id.clone(),
                    lesson.activities,
                    ordinary_policy(),
                )
            }
            SessionMode::FocusedPractice => {
                let pack = catalog.locate(locale, target)?;
                let _: Objective = catalog.get(&pack.release_id, target, "objective")?;
                let items = catalog.practice_activities(&pack.release_id, target, skill)?;
                (pack.release_id.clone(), items, ordinary_policy())
            }
            SessionMode::Test => {
                let pack = catalog.locate(locale, target)?;
                let assessment: Assessment = catalog.get(&pack.release_id, target, "assessment")?;
                (
                    pack.release_id.clone(),
                    assessment.activities,
                    SessionPolicy {
                        hints_allowed: false,
                        tutor_allowed: false,
                        reveal: RevealPolicy::AfterSession,
                        audio_replays: Some(assessment.audio_replays),
                        time_limit_seconds: Some(assessment.duration_seconds),
                    },
                )
            }
        };
        self.start_plan(
            catalog,
            SessionPlan {
                locale,
                mode,
                target: target.clone(),
                release,
                activities,
                policy,
            },
            now,
        )
    }
    pub(crate) fn start_plan(
        &mut self,
        catalog: &Catalog,
        plan: SessionPlan,
        now: i64,
    ) -> Result<SessionSnapshot> {
        let SessionPlan {
            locale,
            mode,
            target,
            release,
            mut activities,
            policy,
        } = plan;
        self.check_reference_access()?;
        if activities.is_empty() || activities.len() > 200 {
            return Err(Error::Invalid("session.empty".into()));
        }
        let id = new_id();
        let deadline = policy
            .time_limit_seconds
            .map(|v| now.saturating_add(i64::from(v.get()) * 1000));
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT INTO sessions(id,source_language,release_id,target_id,mode,status,policy_json,started_ms,updated_ms,deadline_ms) VALUES(?1,?2,?3,?4,?5,'active',?6,?7,?7,?8)",params![id.as_str(),locale.code(),release.as_str(),target.id.as_str(),wire(&mode)?,json(&policy)?,now,deadline])?;
        for (position, r) in activities.drain(..).enumerate() {
            let activity: Activity = catalog.get(&release, &r, "activity")?;
            let mut view = catalog.activity_view(&release, &activity, 0)?;
            if mode == SessionMode::Test
                && view.visible_materials.iter().any(|material| {
                    material
                        .blocks
                        .iter()
                        .any(|block| matches!(block, Block::RecordedAudio { .. }))
                })
            {
                return Err(Error::Policy("speech.input_not_allowed".into()));
            }
            if !policy.hints_allowed {
                view.hints_remaining = 0;
            }
            match &mut view.task {
                TaskView::Choice { options, .. } => options.shuffle(&mut rand::rng()),
                TaskView::Order { items } => items.shuffle(&mut rand::rng()),
                _ => {}
            }
            tx.execute("INSERT INTO session_steps(id,session_id,position,activity_id,activity_revision,view_json) VALUES(?1,?2,?3,?4,?5,?6)",params![new_id().as_str(),id.as_str(),position as i64,r.id.as_str(),r.revision.get(),json(&view)?])?;
        }
        let snapshot = read_snapshot(&tx, &id)?;
        tx.commit()?;
        Ok(snapshot)
    }
    pub fn save_draft(
        &mut self,
        context: &MutationContext,
        sequence: u32,
        answer: &Answer,
        now: i64,
    ) -> Result<u32> {
        if json(answer)?.len() > 60_000 {
            return Err(Error::Invalid("answer.too_long".into()));
        }
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let snapshot = read_snapshot(&tx, &context.session_id)?;
        context_check(&snapshot, context)?;
        let SessionState::Active { step } = &snapshot.session else {
            return Err(Error::Conflict);
        };
        if !matches!(step.phase, StepPhase::Answering) {
            return Err(Error::Conflict);
        }
        let accepted = sequence.max(step.draft_sequence);
        if sequence > step.draft_sequence {
            tx.execute(
                "UPDATE session_steps SET draft_json=?2,draft_sequence=?3 WHERE id=?1",
                params![context.step_id.as_str(), json(answer)?, sequence],
            )?;
            tx.execute(
                "UPDATE sessions SET updated_ms=?2 WHERE id=?1",
                params![context.session_id.as_str(), now],
            )?;
        }
        tx.commit()?;
        Ok(accepted)
    }
    pub fn submit(
        &mut self,
        catalog: &Catalog,
        submission: &SubmitAnswer,
        now: i64,
    ) -> Result<SessionSnapshot> {
        let request = json(submission)?;
        if request.len() > 65_000 {
            return Err(Error::Invalid("answer.too_long".into()));
        }
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(previous) = existing_mutation(&tx, &submission.submission_id, &request)? {
            return Ok(previous);
        }
        let context = &submission.context;
        let snapshot = read_snapshot(&tx, &context.session_id)?;
        context_check(&snapshot, context)?;
        if snapshot
            .deadline_ms
            .is_some_and(|deadline| now as f64 >= deadline)
        {
            return Err(Error::Policy("test.time_expired".into()));
        }
        let SessionState::Active { step } = &snapshot.session else {
            return Err(Error::Conflict);
        };
        if !matches!(step.phase, StepPhase::Answering) {
            return Err(Error::Conflict);
        }
        let activity: Activity =
            catalog.get(&snapshot.release_id, &step.activity.content, "activity")?;
        let assisted: bool = tx.query_row(
            "SELECT hints_used>0 OR assisted=1 FROM session_steps WHERE id=?1",
            [context.step_id.as_str()],
            |r| r.get(0),
        )?;
        let recognized: Option<String> = if let Answer::Voice { recognition_id, .. } =
            &submission.answer
        {
            Some(tx.query_row("SELECT transcript FROM recognitions WHERE id=?1 AND session_id=?2 AND step_id=?3",params![recognition_id.as_str(),context.session_id.as_str(),context.step_id.as_str()],|r|r.get(0)).optional()?.ok_or_else(||Error::Invalid("answer.recognition_missing".into()))?)
        } else {
            None
        };
        if let Answer::Recording { recording_id } = &submission.answer {
            let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM recordings WHERE id=?1 AND session_id=?2 AND step_id=?3)",params![recording_id.as_str(),context.session_id.as_str(),context.step_id.as_str()],|r|r.get(0))?;
            if !valid {
                return Err(Error::Invalid("answer.recording_missing".into()));
            }
        }
        let evaluation = evaluate(
            &activity.task,
            &submission.answer,
            EvidenceContext {
                hints_used: assisted,
                recognized_transcript: recognized.as_deref(),
            },
        )
        .map_err(|e| Error::Invalid(e.0.into()))?;
        let feedback = Feedback {
            outcome: evaluation.outcome,
            evidence: evaluation.evidence,
            message: None,
            explanation: evaluation
                .explanation
                .as_ref()
                .map(|r| catalog.get(&snapshot.release_id, r, "material"))
                .transpose()?,
            rubric: evaluation
                .rubric
                .as_ref()
                .map(|r| catalog.get(&snapshot.release_id, r, "rubric"))
                .transpose()?,
        };
        let attempt_id = new_id();
        tx.execute("INSERT INTO attempts(id,session_id,step_id,activity_id,activity_revision,source_language,answer_json,outcome,evidence,created_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![attempt_id.as_str(),context.session_id.as_str(),context.step_id.as_str(),activity.content.id.as_str(),activity.content.revision.get(),snapshot.source_language.code(),json(&submission.answer)?,wire(&feedback.outcome)?,wire(&feedback.evidence)?,now])?;
        let scope = if matches!(activity.evidence_scope, EvidenceScope::Spanish) {
            "es"
        } else {
            snapshot.source_language.code()
        };
        let lexical_sense = activity.lexical.first().map(|p| &p.sense);
        let scope = if lexical_sense.is_some() {
            snapshot.source_language.code()
        } else {
            scope
        };
        let review_id = lexical_sense.map_or_else(
            || format!("{scope}:{}", activity.content.id),
            |sense| format!("lex:{scope}:{}", sense.id),
        );
        let enrolled: bool = if let Some(sense) = lexical_sense {
            tx.query_row("SELECT EXISTS(SELECT 1 FROM vocabulary WHERE sense_id=?1 AND locale=?2 AND status='active')", params![sense.id.as_str(),scope], |r|r.get(0))?
        } else {
            true
        };
        super::connected::record_evidence(
            &tx,
            &attempt_id,
            &activity,
            &submission.answer,
            &feedback,
            snapshot.source_language,
        )?;
        for target in &activity.lexical {
            let occurrence: Occurrence =
                catalog.get(&snapshot.release_id, &target.occurrence, "occurrence")?;
            tx.execute("INSERT INTO vocabulary_contexts(sense_id,locale,occurrence_id,occurrence_json,encountered_ms) SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM vocabulary WHERE sense_id=?1 AND locale=?2) ON CONFLICT(sense_id,locale,occurrence_id) DO UPDATE SET encountered_ms=excluded.encountered_ms",params![target.sense.id.as_str(),snapshot.source_language.code(),target.occurrence.id.as_str(),json(&occurrence)?,now])?;
        }

        let previous = tx
            .query_row(
                "SELECT stability,difficulty,due_ms,last_review_ms FROM reviews WHERE id=?1",
                [&review_id],
                |r| {
                    Ok(ReviewMemory {
                        stability: r.get(0)?,
                        difficulty: r.get(1)?,
                        due_ms: r.get(2)?,
                        last_review_ms: r.get(3)?,
                    })
                },
            )
            .optional()?;
        let next_review = if enrolled
            && activity.usage.is_practice()
            && matches!(activity.task, Task::ShortAnswer { .. })
        {
            schedule(previous.as_ref(), feedback.outcome, feedback.evidence, now)
                .map_err(Error::Invalid)?
        } else {
            None
        };
        if let Some(memory) = next_review {
            tx.execute("INSERT INTO reviews(id,activity_id,source_language,release_id,revision,stability,difficulty,due_ms,last_review_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(id) DO UPDATE SET activity_id=excluded.activity_id,revision=excluded.revision,release_id=excluded.release_id,stability=excluded.stability,difficulty=excluded.difficulty,due_ms=excluded.due_ms,last_review_ms=excluded.last_review_ms",params![review_id,activity.content.id.as_str(),scope,snapshot.release_id.as_str(),activity.content.revision.get(),memory.stability,memory.difficulty,memory.due_ms,memory.last_review_ms])?;
            if let Some(sense) = lexical_sense {
                tx.execute(
                    "UPDATE reviews SET sense_id=?2 WHERE id=?1",
                    params![review_id, sense.id.as_str()],
                )?;
            }
            tx.execute(
                "INSERT INTO review_history(attempt_id,review_id,state_json) VALUES(?1,?2,?3)",
                params![attempt_id.as_str(), review_id, json(&memory)?],
            )?;
        }
        tx.execute("UPDATE session_steps SET phase='feedback',version=version+1,draft_json=?2,feedback_json=?3 WHERE id=?1",params![context.step_id.as_str(),json(&submission.answer)?,json(&feedback)?])?;
        tx.execute(
            "UPDATE sessions SET version=version+1,updated_ms=?2 WHERE id=?1",
            params![context.session_id.as_str(), now],
        )?;
        let result = read_snapshot(&tx, &context.session_id)?;
        save_mutation(&tx, &submission.submission_id, &request, &result)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn advance(
        &mut self,
        context: &MutationContext,
        mutation: &Id,
        now: i64,
    ) -> Result<SessionSnapshot> {
        let request = json(&("advance", context))?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(previous) = existing_mutation(&tx, mutation, &request)? {
            return Ok(previous);
        }
        let snapshot = read_snapshot(&tx, &context.session_id)?;
        context_check(&snapshot, context)?;
        let SessionState::Active { step } = &snapshot.session else {
            return Err(Error::Conflict);
        };
        if !matches!(step.phase, StepPhase::Feedback) {
            return Err(Error::Conflict);
        }
        let complete = step.index + 1 >= snapshot.step_count.get();
        tx.execute("UPDATE sessions SET current_index=current_index+1,version=version+1,updated_ms=?2,status=?3 WHERE id=?1",params![context.session_id.as_str(),now,if complete{"completed"}else{"active"}])?;
        let result = read_snapshot(&tx, &context.session_id)?;
        save_mutation(&tx, mutation, &request, &result)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn hint(
        &mut self,
        catalog: &Catalog,
        context: &MutationContext,
        mutation: &Id,
        now: i64,
    ) -> Result<(Material, SessionSnapshot)> {
        let request = json(&("hint", context))?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(previous) = existing_mutation(&tx, mutation, &request)? {
            let SessionState::Active { step } = &previous.session else {
                return Err(Error::Conflict);
            };
            let material = step
                .activity
                .visible_materials
                .last()
                .cloned()
                .ok_or(Error::NotFound)?;
            return Ok((material, previous));
        }
        let snapshot = read_snapshot(&tx, &context.session_id)?;
        context_check(&snapshot, context)?;
        if !snapshot.policy.hints_allowed {
            return Err(Error::Policy("test.hints_unavailable".into()));
        }
        let SessionState::Active { step } = &snapshot.session else {
            return Err(Error::Conflict);
        };
        if !matches!(step.phase, StepPhase::Answering) {
            return Err(Error::Conflict);
        }
        let activity: Activity =
            catalog.get(&snapshot.release_id, &step.activity.content, "activity")?;
        let used: u32 = tx.query_row(
            "SELECT hints_used FROM session_steps WHERE id=?1",
            [context.step_id.as_str()],
            |r| r.get(0),
        )?;
        let hint = activity
            .hints
            .get(used as usize)
            .ok_or_else(|| Error::Invalid("lesson.no_more_hints".into()))?;
        let material: Material = catalog.get(&snapshot.release_id, hint, "material")?;
        let mut view = step.activity.clone();
        view.visible_materials.push(material.clone());
        view.hints_remaining = view.hints_remaining.saturating_sub(1);
        tx.execute("UPDATE session_steps SET view_json=?2,hints_used=hints_used+1,assisted=1,version=version+1 WHERE id=?1",params![context.step_id.as_str(),json(&view)?])?;
        tx.execute(
            "UPDATE sessions SET version=version+1,updated_ms=?2 WHERE id=?1",
            params![context.session_id.as_str(), now],
        )?;
        let result = read_snapshot(&tx, &context.session_id)?;
        save_mutation(&tx, mutation, &request, &result)?;
        tx.commit()?;
        Ok((material, result))
    }
    pub fn session_review(&self, id: &Id) -> Result<SessionReview> {
        self.check_reference_access()?;
        let session = self.snapshot(id)?;
        if matches!(session.session, SessionState::Active { .. }) {
            return Err(Error::Policy("session.finish_first".into()));
        }
        let mut steps = Vec::new();
        for row in self.db.prepare("SELECT view_json,draft_json,feedback_json FROM session_steps WHERE session_id=?1 ORDER BY position")?.query_map([id.as_str()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,Option<String>>(2)?)))?{
            let (view,answer,feedback)=row?;steps.push(ReviewedStep{activity:from_json(&view)?,answer:answer.map(|v|from_json(&v)).transpose()?,feedback:feedback.map(|v|from_json(&v)).transpose()?});
        }
        Ok(SessionReview { session, steps })
    }
    pub fn register_recognition(
        &self,
        context: &MutationContext,
        text: &str,
    ) -> Result<Recognition> {
        let snapshot = self.snapshot(&context.session_id)?;
        context_check(&snapshot, context)?;
        if text.trim().is_empty() {
            return Err(Error::Invalid("speech.no_speech".into()));
        }
        let recognition = Recognition {
            recognition_id: new_id(),
            session_id: context.session_id.clone(),
            step_id: context.step_id.clone(),
            language: Language::Es,
            transcript: text.trim().into(),
        };
        self.db.execute(
            "INSERT INTO recognitions(id,session_id,step_id,transcript) VALUES(?1,?2,?3,?4)",
            params![
                recognition.recognition_id.as_str(),
                recognition.session_id.as_str(),
                recognition.step_id.as_str(),
                recognition.transcript
            ],
        )?;
        Ok(recognition)
    }
    pub fn register_recording(
        &self,
        context: &MutationContext,
        path: &Path,
        duration_ms: u32,
    ) -> Result<Id> {
        self.validate_recording_context(context)?;
        let id = new_id();
        self.db.execute(
            "INSERT INTO recordings(id,session_id,step_id,path,duration_ms) VALUES(?1,?2,?3,?4,?5)",
            params![
                id.as_str(),
                context.session_id.as_str(),
                context.step_id.as_str(),
                path.to_string_lossy(),
                duration_ms
            ],
        )?;
        Ok(id)
    }
    pub fn validate_recording_context(
        &self,
        context: &MutationContext,
    ) -> Result<(SessionSnapshot, bool, u32)> {
        let snapshot = self.snapshot(&context.session_id)?;
        // A submitted production task may receive a new recording without replacing its first attempt.
        let submitted: Option<(String,u32)> = self.db.query_row("SELECT ss.view_json,ss.version FROM session_steps ss JOIN attempts a ON a.step_id=ss.id JOIN sessions s ON s.id=ss.session_id WHERE ss.id=?1 AND s.id=?2 AND a.outcome='needs_self_review' AND (s.mode!='test' OR s.status='completed')", params![context.step_id.as_str(),context.session_id.as_str()], |r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((view, version)) = submitted {
            self.check_reference_access()?;
            if version != context.expected_step_version.get() {
                return Err(Error::Conflict);
            }
            if let TaskView::Speaking { max_seconds, .. } = from_json::<ActivityView>(&view)?.task {
                return Ok((snapshot, true, max_seconds.get().min(300)));
            }
        }
        context_check(&snapshot, context)?;
        let SessionState::Active { step } = &snapshot.session else {
            return Err(Error::Conflict);
        };
        if !matches!(step.phase, StepPhase::Answering) {
            return Err(Error::Conflict);
        }
        let (open, seconds) = match &step.activity.task {
            TaskView::ShortAnswer { inputs, target, .. }
                if inputs.contains(&InputMode::Microphone)
                    && *target != TextTarget::Orthography =>
            {
                (false, 30)
            }
            TaskView::Speaking { max_seconds, .. } => (true, max_seconds.get().min(300)),
            _ => return Err(Error::Policy("speech.input_not_allowed".into())),
        };
        Ok((snapshot, open, seconds))
    }
    pub fn recording_path(&self, id: &Id) -> Result<PathBuf> {
        self.check_reference_access()?;
        let name: String = self
            .db
            .query_row(
                "SELECT path FROM recordings WHERE id=?1",
                [id.as_str()],
                |r| r.get(0),
            )
            .optional()?
            .ok_or(Error::NotFound)?;
        let relative = Path::new(&name);
        if relative.components().count() != 1
            || !matches!(
                relative.components().next(),
                Some(std::path::Component::Normal(_))
            )
        {
            return Err(Error::Invalid("recording.invalid_path".into()));
        }
        Ok(self.directory.join("recordings").join(relative))
    }
}

pub(crate) fn ordinary_policy() -> SessionPolicy {
    SessionPolicy {
        hints_allowed: true,
        tutor_allowed: true,
        reveal: RevealPolicy::AfterSubmission,
        audio_replays: None,
        time_limit_seconds: None,
    }
}
