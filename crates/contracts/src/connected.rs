//! Connected learning: immutable editorial content and durable learner actions.
use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Annotation {
    /// Unicode scalar offsets, not bytes or UTF-16 code units.
    pub start: u32,
    pub end: u32,
    pub occurrence: ContentRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Occurrence {
    pub content: ContentRef,
    pub sense: ContentRef,
    pub surface: String,
    pub context: Text,
    pub meaning: Text,
    pub owner: ContentRef,
    pub speech: Option<ContentRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Topic {
    pub content: ContentRef,
    pub title: Text,
    pub question: Text,
    pub description: Text,
    pub outcomes: Vec<Text>,
    pub missions: Vec<ContentRef>,
    pub sources: Vec<Source>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub title: String,
    pub url: String,
    pub accessed: String,
    pub note: Text,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Mission {
    pub content: ContentRef,
    pub title: Text,
    pub question: Text,
    pub outcome: Text,
    pub description: Text,
    pub band: Band,
    pub lesson: ContentRef,
    pub challenge: ContentRef,
    pub vocabulary: Vec<ContentRef>,
    pub sources: Vec<Source>,
    pub attribution: Text,
    pub order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LexicalPractice {
    pub sense: ContentRef,
    pub occurrence: ContentRef,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WordStatus {
    Recent,
    Active,
    Paused,
    Archived,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SupportLevel {
    Learn,
    Independent,
    Rehearsal,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WordView {
    pub sense: LexicalSense,
    pub status: WordStatus,
    pub notes: String,
    pub contexts: Vec<Occurrence>,
    pub due_ms: Option<f64>,
    pub understanding: u32,
    pub independent_recall: u32,
    pub assisted_recall: u32,
    pub spoken_recognition: u32,
    pub productive_attempts: u32,
    pub spelling_recall: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MissionView {
    pub mission: Mission,
    pub completed: bool,
    pub challenge_seen: bool,
    pub unseen_completed: bool,
    pub resume: Option<Id>,
    pub minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TopicView {
    pub topic: Topic,
    pub missions: Vec<MissionView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DailyPlan {
    pub recommended: Option<MissionView>,
    pub topics: Vec<TopicView>,
    pub due: u32,
    pub review_limit: u32,
    pub new_word_limit: u32,
    pub minutes: u32,
    pub interests: Vec<Id>,
    pub independent_words: u32,
    pub unseen_tasks: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NotebookEntry {
    pub id: Id,
    pub text: String,
    pub source: ContentRef,
    pub source_title: String,
    pub counterargument: String,
    pub created_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Revision {
    pub id: Id,
    pub answer: Answer,
    /// Self-review only: met / developing / not_assessed. Never an automatic grade.
    pub criteria: std::collections::BTreeMap<Id, SelfReview>,
    pub created_ms: f64,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SelfReview {
    Met,
    Developing,
    NotAssessed,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProductionRecord {
    pub context: MutationContext,
    pub session_id: Id,
    pub step_id: Id,
    pub activity: ActivityView,
    pub original: Answer,
    pub feedback: Feedback,
    pub revisions: Vec<Revision>,
    pub created_ms: f64,
    pub assisted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MissionRecap {
    pub mission: Option<Mission>,
    pub suggestions: Vec<WordView>,
    pub productions: Vec<ProductionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ConnectedCommand {
    Today,
    Interests {
        topics: Vec<Id>,
    },
    Words,
    Lookup {
        occurrence: ContentRef,
        context: Option<MutationContext>,
        opened: bool,
    },
    LearnWord {
        occurrence: ContentRef,
        context: Option<MutationContext>,
    },
    UpdateWord {
        sense: ContentRef,
        status: WordStatus,
        notes: String,
    },
    StartMission {
        mission: ContentRef,
        support: SupportLevel,
    },
    ReviewWords {
        sense: Option<ContentRef>,
        production: bool,
    },
    Recap {
        session_id: Id,
    },
    Productions,
    Revise {
        step_id: Id,
        answer: Answer,
        criteria: std::collections::BTreeMap<Id, SelfReview>,
    },
    Notebook,
    SaveArgument {
        id: Option<Id>,
        source: ContentRef,
        text: String,
        counterargument: String,
    },
    DeleteArgument {
        id: Id,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    content = "data",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum ConnectedResponse {
    Today(DailyPlan),
    Words(Vec<WordView>),
    Word(Box<WordView>),
    Session(Box<SessionSnapshot>),
    Recap(MissionRecap),
    Productions(Vec<ProductionRecord>),
    Notebook(Vec<NotebookEntry>),
    Accepted,
}
