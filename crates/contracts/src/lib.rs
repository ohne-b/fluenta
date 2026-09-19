//! Shared content and application wire contracts.
//! Deserialization validates structure; `Activity::validate` checks teaching invariants.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{borrow::Cow, collections::BTreeSet, num::NonZeroU32};

mod app;
mod connected;
pub use app::*;
pub use connected::*;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Id(String);

impl JsonSchema for Id {
    fn schema_name() -> Cow<'static, str> {
        "Id".into()
    }

    fn json_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
        schemars::json_schema!({
            "type": "string", "minLength": 1, "maxLength": 160,
            "not": { "pattern": "[^A-Za-z0-9._:-]" }
        })
    }
}

impl TryFrom<String> for Id {
    type Error = String;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty()
            || value.len() > 160
            || !value
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))
        {
            return Err(
                "ID must contain 1–160 ASCII letters, digits, dots, underscores, colons or hyphens"
                    .into(),
            );
        }
        Ok(Self(value))
    }
}

impl From<Id> for String {
    fn from(value: Id) -> Self {
        value.0
    }
}

impl Id {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for Id {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SourceLanguage {
    De,
    En,
}

impl SourceLanguage {
    pub fn code(self) -> &'static str {
        match self {
            Self::De => "de",
            Self::En => "en",
        }
    }
    pub fn language(self) -> Language {
        match self {
            Self::De => Language::De,
            Self::En => Language::En,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Language {
    De,
    En,
    Es,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum Band {
    A1,
    A2,
    B1,
    B2,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ContentRef {
    pub id: Id,
    pub revision: NonZeroU32,
}

/// Fully resolved source-language teaching material, never executable markup.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Text {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub annotations: Vec<Annotation>,
    pub language: Language,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Block {
    SourceText {
        language: Language,
        text: String,
        caption: Text,
    },
    Image {
        png: Vec<u8>,
        alt: Text,
        caption: Text,
    },
    RecordedAudio {
        wav: Vec<u8>,
        caption: Text,
        synthetic: bool,
    },
    Audio {
        speech: ContentRef,
    },
    Paragraph {
        spans: Vec<Text>,
    },
    Heading {
        spans: Vec<Text>,
    },
    Example {
        spans: Vec<Text>,
        speech: Option<ContentRef>,
    },
    List {
        items: Vec<Vec<Text>>,
    },
    Table {
        caption: Text,
        columns: Vec<Text>,
        rows: Vec<Vec<Text>>,
    },
    Reference {
        target: ContentRef,
        label: Text,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Material {
    pub content: ContentRef,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub searchable: bool,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum GrammarCategory {
    Verbs,
    Nouns,
    Sentences,
}

/// A grammar course links canonical explanations to lessons that apply them.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GrammarTopic {
    pub content: ContentRef,
    pub title: Text,
    pub summary: Text,
    pub band: Band,
    pub category: GrammarCategory,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<Text>,
    #[serde(default)]
    pub order: u16,
    pub explanations: Vec<ContentRef>,
    pub lessons: Vec<ContentRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Objective {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub grammar_topics: Vec<Id>,
    pub content: ContentRef,
    pub band: Band,
    pub can_do: Text,
    pub prerequisites: Vec<ContentRef>,
    pub explanation_refs: Vec<ContentRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Lesson {
    pub content: ContentRef,
    pub title: Text,
    pub objectives: Vec<ContentRef>,
    pub activities: Vec<ContentRef>,
    pub estimated_minutes: NonZeroU32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Unit {
    pub content: ContentRef,
    pub title: Text,
    pub objectives: Vec<ContentRef>,
    pub lessons: Vec<ContentRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assessment: Option<ContentRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Course {
    pub content: ContentRef,
    pub source_language: SourceLanguage,
    pub band: Band,
    pub title: Text,
    pub units: Vec<ContentRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SpeechSegment {
    pub content: ContentRef,
    pub text: String,
    pub speaker_role: Option<Id>,
    pub pronunciation_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LexicalSense {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub practice: Vec<ContentRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub topics: Vec<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grammar: Option<Text>,
    pub content: ContentRef,
    pub lemma: String,
    pub part_of_speech: String,
    pub gloss: Text,
    pub accepted_forms: Vec<String>,
    pub examples: Vec<ContentRef>,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum InputMode {
    Keyboard,
    Microphone,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TextTarget {
    Orthography,
    SentenceContent,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum Normalization {
    UnicodeNfc,
    Trim,
    CollapseWhitespace,
    IgnoreCase,
    IgnoreTerminalPunctuation,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct KnownMistake {
    pub answers: Vec<String>,
    pub feedback: ContentRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct OptionItem {
    pub id: Id,
    pub label: Text,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RubricCriterion {
    pub id: Id,
    pub label: Text,
    pub guidance: Text,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Rubric {
    pub content: ContentRef,
    pub criteria: Vec<RubricCriterion>,
    pub model_answers: Vec<ContentRef>,
}

/// Data for the evaluator/compiler. Never pass this answer-bearing enum to the UI.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Task {
    Explanation {
        material: ContentRef,
    },
    Choice {
        options: Vec<OptionItem>,
        correct_ids: Vec<Id>,
        explanation: ContentRef,
    },
    Order {
        items: Vec<OptionItem>,
        accepted_orders: Vec<Vec<Id>>,
        explanation: ContentRef,
    },
    ShortAnswer {
        language: Language,
        target: TextTarget,
        inputs: Vec<InputMode>,
        accepted: Vec<String>,
        normalization: Vec<Normalization>,
        mistakes: Vec<KnownMistake>,
        explanation: ContentRef,
    },
    Writing {
        language: Language,
        min_words: u32,
        max_words: NonZeroU32,
        rubric: ContentRef,
    },
    Speaking {
        language: Language,
        max_seconds: NonZeroU32,
        rubric: ContentRef,
        keyboard_alternative: ContentRef,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RevealPolicy {
    AfterSubmission,
    OnRequest,
    AfterSession,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Activity {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub preparation: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lexical: Vec<LexicalPractice>,
    pub content: ContentRef,
    pub instruction: Text,
    pub objectives: Vec<ContentRef>,
    pub materials: Vec<ContentRef>,
    pub hints: Vec<ContentRef>,
    pub reveal_policy: RevealPolicy,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<Skill>,
    #[serde(default, skip_serializing_if = "EvidenceScope::is_source_language")]
    pub evidence_scope: EvidenceScope,
    #[serde(default, skip_serializing_if = "ActivityUse::is_practice")]
    pub usage: ActivityUse,
    pub task: Task,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Skill {
    Grammar,
    Vocabulary,
    Reading,
    Listening,
    Writing,
    Speaking,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceScope {
    Spanish,
    #[default]
    SourceLanguage,
}
impl EvidenceScope {
    pub fn is_source_language(&self) -> bool {
        matches!(self, Self::SourceLanguage)
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ActivityUse {
    #[default]
    Practice,
    Assessment,
}
impl ActivityUse {
    pub fn is_practice(&self) -> bool {
        matches!(self, Self::Practice)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Assessment {
    pub content: ContentRef,
    pub title: Text,
    pub activities: Vec<ContentRef>,
    pub duration_seconds: NonZeroU32,
    pub audio_replays: u32,
}

impl Activity {
    pub fn validate(&self) -> Result<(), String> {
        if self.instruction.text.trim().is_empty() || self.objectives.is_empty() {
            return Err("activity needs an instruction and at least one objective".into());
        }
        match &self.task {
            Task::Choice {
                options,
                correct_ids,
                ..
            } => {
                let ids: BTreeSet<_> = options.iter().map(|x| &x.id).collect();
                let correct: BTreeSet<_> = correct_ids.iter().collect();
                if options.len() < 2
                    || ids.len() != options.len()
                    || correct.is_empty()
                    || correct.len() != correct_ids.len()
                    || !correct.is_subset(&ids)
                {
                    return Err(
                        "choice requires distinct options and valid distinct correct IDs".into(),
                    );
                }
            }
            Task::Order {
                items,
                accepted_orders,
                ..
            } => {
                let ids: BTreeSet<_> = items.iter().map(|x| &x.id).collect();
                if items.len() < 2
                    || ids.len() != items.len()
                    || accepted_orders.is_empty()
                    || accepted_orders.iter().any(|order| {
                        order.len() != items.len() || order.iter().collect::<BTreeSet<_>>() != ids
                    })
                {
                    return Err(
                        "accepted orders must be permutations of the distinct item IDs".into(),
                    );
                }
            }
            Task::ShortAnswer {
                target,
                inputs,
                accepted,
                normalization,
                ..
            } => {
                if inputs.is_empty()
                    || inputs.iter().collect::<BTreeSet<_>>().len() != inputs.len()
                    || accepted.is_empty()
                    || accepted.iter().any(|s| s.trim().is_empty())
                {
                    return Err(
                        "short answer requires distinct input modes and nonempty accepted answers"
                            .into(),
                    );
                }
                if *target == TextTarget::Orthography && inputs.contains(&InputMode::Microphone) {
                    return Err("ASR cannot provide orthographic evidence".into());
                }
                if !normalization.contains(&Normalization::UnicodeNfc)
                    || normalization.iter().collect::<BTreeSet<_>>().len() != normalization.len()
                {
                    return Err("normalization requires NFC and no repeated operations".into());
                }
            }
            Task::Writing {
                min_words,
                max_words,
                ..
            } if *min_words > max_words.get() => {
                return Err("writing word range is inverted".into());
            }
            _ => {}
        }
        Ok(())
    }
}

/// Complete compiled content fixture. Real packs keep these records in indexed SQLite.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CoursePack {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub topics: Vec<Topic>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub missions: Vec<Mission>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub occurrences: Vec<Occurrence>,
    pub schema_version: NonZeroU32,
    pub release_id: Id,
    pub course: Course,
    pub units: Vec<Unit>,
    pub lessons: Vec<Lesson>,
    pub objectives: Vec<Objective>,
    pub activities: Vec<Activity>,
    pub materials: Vec<Material>,
    pub speech: Vec<SpeechSegment>,
    pub vocabulary: Vec<LexicalSense>,
    pub rubrics: Vec<Rubric>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assessments: Vec<Assessment>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub grammar: Vec<GrammarTopic>,
}

/// Answer-free projection. Solutions remain in Rust until reveal is permitted.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TaskView {
    Explanation {
        material: ContentRef,
    },
    Choice {
        options: Vec<OptionItem>,
        multiple: bool,
    },
    Order {
        items: Vec<OptionItem>,
    },
    ShortAnswer {
        language: Language,
        target: TextTarget,
        inputs: Vec<InputMode>,
    },
    Writing {
        language: Language,
        min_words: u32,
        max_words: NonZeroU32,
    },
    Speaking {
        language: Language,
        max_seconds: NonZeroU32,
        keyboard_alternative: ContentRef,
    },
}

impl From<&Task> for TaskView {
    fn from(task: &Task) -> Self {
        match task {
            Task::Explanation { material } => Self::Explanation {
                material: material.clone(),
            },
            Task::Choice {
                options,
                correct_ids,
                ..
            } => Self::Choice {
                options: options.clone(),
                multiple: correct_ids.len() > 1,
            },
            Task::Order { items, .. } => Self::Order {
                items: items.clone(),
            },
            Task::ShortAnswer {
                language,
                target,
                inputs,
                ..
            } => Self::ShortAnswer {
                language: *language,
                target: *target,
                inputs: inputs.clone(),
            },
            Task::Writing {
                language,
                min_words,
                max_words,
                ..
            } => Self::Writing {
                language: *language,
                min_words: *min_words,
                max_words: *max_words,
            },
            Task::Speaking {
                language,
                max_seconds,
                keyboard_alternative,
                ..
            } => Self::Speaking {
                language: *language,
                max_seconds: *max_seconds,
                keyboard_alternative: keyboard_alternative.clone(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ActivityView {
    pub content: ContentRef,
    pub instruction: Text,
    pub visible_materials: Vec<Material>,
    pub hints_remaining: u32,
    pub task: TaskView,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Answer {
    Acknowledged,
    Choice {
        selected_ids: Vec<Id>,
    },
    Order {
        ordered_ids: Vec<Id>,
    },
    Typed {
        text: String,
    },
    Voice {
        recognition_id: Id,
        confirmed_text: String,
    },
    Writing {
        text: String,
    },
    Recording {
        recording_id: Id,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionMode {
    Lesson,
    Review,
    FocusedPractice,
    Test,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum StepPhase {
    Answering,
    Feedback,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SessionPolicy {
    pub hints_allowed: bool,
    pub tutor_allowed: bool,
    pub reveal: RevealPolicy,
    pub audio_replays: Option<u32>,
    pub time_limit_seconds: Option<NonZeroU32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ActiveStep {
    pub step_id: Id,
    pub version: NonZeroU32,
    pub index: u32,
    pub phase: StepPhase,
    pub activity: ActivityView,
    pub draft: Option<Answer>,
    pub draft_sequence: u32,
    pub audio_plays: u32,
    pub feedback: Option<Feedback>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum SessionState {
    Active { step: Box<ActiveStep> },
    Completed { summary: SessionSummary },
    Abandoned,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SessionSnapshot {
    pub session_id: Id,
    pub source_language: SourceLanguage,
    pub mode: SessionMode,
    pub release_id: Id,
    pub version: NonZeroU32,
    pub step_count: NonZeroU32,
    pub policy: SessionPolicy,
    pub session: SessionState,
    pub deadline_ms: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Correct,
    Incorrect,
    Completed,
    NeedsSelfReview,
    DeferredUntilRecap,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Evidence {
    None,
    UnaidedRecall,
    AssistedRecall,
    RecognizedContent,
    EditedTranscript,
    SelfAssessment,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Feedback {
    pub outcome: Outcome,
    pub evidence: Evidence,
    pub message: Option<Text>,
    pub explanation: Option<Material>,
    pub rubric: Option<Rubric>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SessionSummary {
    pub completed_steps: u32,
    pub objectively_marked: u32,
    pub correct_unaided: u32,
    pub needs_review: Vec<ContentRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MutationContext {
    pub session_id: Id,
    pub step_id: Id,
    pub expected_step_version: NonZeroU32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SubmitAnswer {
    pub context: MutationContext,
    pub submission_id: Id,
    pub answer: Answer,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Recognition {
    pub recognition_id: Id,
    pub session_id: Id,
    pub step_id: Id,
    pub language: Language,
    pub transcript: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ReferenceExcerpt {
    pub content: ContentRef,
    pub text: Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TutorMode {
    Conversation,
    Explain,
    WritingFeedback,
}

/// Constructed by the backend. The UI cannot supply or extend this whitelist.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TutorContext {
    pub source_language: SourceLanguage,
    pub band: Band,
    pub mode: TutorMode,
    pub objective: Option<ContentRef>,
    pub visible_task: Option<ActivityView>,
    pub submitted_answer: Option<Answer>,
    pub references: Vec<ReferenceExcerpt>,
    pub solution_revealed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TutorReply {
    pub reply_es: String,
    pub explanation_native: String,
    pub reference_ids: Vec<Id>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "command",
    content = "payload",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum Command {
    OpenSource {
        url: String,
    },
    Connected(ConnectedCommand),
    GetHome,
    GetOverview,
    GetSettings,
    UpdateSettings {
        settings: Settings,
    },
    GetSessionReview {
        session_id: Id,
    },
    AbandonSession {
        session_id: Id,
    },
    ListTutorThreads,
    GetTutorThread {
        thread_id: Id,
    },
    DeleteTutorThread {
        thread_id: Id,
    },
    GetDownloads,
    RemoveTutor,
    StopPlayback,
    KeyboardAlternative {
        context: MutationContext,
    },
    PlayRecording {
        recording_id: Id,
    },
    SpeakTutor {
        thread_id: Id,
        turn_index: u32,
        slow: bool,
    },
    StartTutorRecording,
    RestoreBackup,
    ImportCourses,
    ListBookmarks {
        source_language: SourceLanguage,
    },
    ListGrammar {
        source_language: SourceLanguage,
    },
    GetGrammarHelp {
        context: MutationContext,
    },
    ToggleBookmark {
        content: ContentRef,
        source_language: SourceLanguage,
    },
    SelectSourceLanguage {
        source_language: SourceLanguage,
    },
    ListUnits {
        source_language: SourceLanguage,
        band: Band,
        cursor: Option<String>,
    },
    SearchContent {
        query: String,
        source_language: SourceLanguage,
        cursor: Option<String>,
    },
    GetLesson {
        content: ContentRef,
        source_language: SourceLanguage,
    },
    GetReference {
        content: ContentRef,
        source_language: SourceLanguage,
    },
    StartSession {
        source_language: SourceLanguage,
        mode: SessionMode,
        target: ContentRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        skill: Option<Skill>,
    },
    ResumeSession {
        session_id: Id,
    },
    SaveDraft {
        context: MutationContext,
        sequence: u32,
        answer: Answer,
    },
    SubmitAnswer(SubmitAnswer),
    AdvanceSession {
        context: MutationContext,
        mutation_id: Id,
    },
    RevealHint {
        context: MutationContext,
        mutation_id: Id,
    },
    StartRecording {
        context: MutationContext,
    },
    StopRecording {
        operation_id: Id,
    },
    Synthesize {
        segment: ContentRef,
        slow: bool,
        context: Option<MutationContext>,
    },
    StartTutorTurn {
        thread_id: Option<Id>,
        mode: TutorMode,
        message: String,
        session_id: Option<Id>,
    },
    InstallPack {
        release_id: Id,
    },
    CancelOperation {
        operation_id: Id,
    },
    ReadOperation {
        operation_id: Id,
        after_sequence: u32,
    },
    CreateBackup,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub protocol_version: NonZeroU32,
    pub request_id: Id,
    pub command: Command,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidRequest,
    NotFound,
    Conflict,
    UnsupportedVersion,
    PolicyDenied,
    PermissionDenied,
    DeviceUnavailable,
    NoSpeech,
    WorkerUnavailable,
    InsufficientSpace,
    StorageFailure,
    DownloadFailure,
    IntegrityFailure,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Failure {
    pub code: ErrorCode,
    pub message_key: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "event",
    content = "payload",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum OperationEvent {
    TranscriptReady {
        transcript: String,
    },
    RecordingStarted,
    RecordingReady {
        recording_id: Id,
        session_id: Id,
        step_id: Id,
        duration_milliseconds: u32,
    },
    RecognitionReady(Recognition),
    Progress {
        completed_bytes: String,
        total_bytes: Option<String>,
    },
    TutorReady {
        thread_id: Id,
        reply: TutorReply,
    },
    Finished,
    Failed(Failure),
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub operation_id: Id,
    pub sequence: u32,
    pub session_id: Option<Id>,
    pub event: OperationEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HomeView {
    pub source_language: SourceLanguage,
    pub continue_session_id: Option<Id>,
    pub recommended_lesson: Option<ContentRef>,
    pub due_reviews: u32,
    pub tutor_installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SearchHit {
    pub content: ContentRef,
    pub title: Text,
    pub excerpt: Text,
}

/// Contributor build only. These are not registered commands in the learner app.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub enum StudioRequest {
    Current,
    Open,
    Read {
        path: String,
    },
    Save {
        path: String,
        text: String,
        expected_sha256: String,
    },
    Validate,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum StudioResponse {
    Workspace {
        root: String,
        files: Vec<String>,
    },
    Document {
        path: String,
        text: String,
        sha256: String,
    },
    Validated {
        packs: u32,
        units: Vec<UnitOverview>,
    },
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    content = "data",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum Success {
    Connected(Box<ConnectedResponse>),
    Home(HomeView),
    Overview(Overview),
    Settings(Settings),
    SessionReview(SessionReview),
    TutorThreads(Vec<TutorThread>),
    TutorThread(ThreadDetail),
    Downloads(Downloads),
    Bookmarks(Vec<SearchHit>),
    Lesson(Lesson),
    Reference(Material),
    Grammar(Vec<GrammarTopic>),
    GrammarHelp(Vec<Material>),
    Units {
        items: Vec<Unit>,
        next_cursor: Option<String>,
    },
    Search {
        items: Vec<SearchHit>,
        next_cursor: Option<String>,
    },
    Session(SessionSnapshot),
    DraftSaved {
        accepted_sequence: u32,
    },
    Hint {
        material: Material,
        session: SessionSnapshot,
    },
    OperationStarted {
        operation_id: Id,
    },
    OperationEvents {
        items: Vec<Event>,
        last_sequence: u32,
        terminal: bool,
    },
    Accepted,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "status",
    content = "payload",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum ResponseResult {
    Ok(Box<Success>),
    Error(Failure),
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Response {
    pub protocol_version: NonZeroU32,
    pub request_id: Id,
    pub result: ResponseResult,
}
