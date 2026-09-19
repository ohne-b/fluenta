use super::*;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub source_language: SourceLanguage,
    pub ui_language: SourceLanguage,
    pub starting_band: Band,
    pub theme: Theme,
    pub daily_minutes: u32,
    pub audio_enabled: bool,
    pub onboarding_complete: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            source_language: SourceLanguage::En,
            ui_language: SourceLanguage::En,
            starting_band: Band::A1,
            theme: Theme::System,
            daily_minutes: 10,
            audio_enabled: true,
            onboarding_complete: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LessonOverview {
    pub content: ContentRef,
    pub title: Text,
    pub estimated_minutes: u32,
    pub activity_count: u32,
    pub completed: bool,
    pub skills: Vec<String>,
    pub objectives: Vec<ContentRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UnitOverview {
    pub content: ContentRef,
    pub title: Text,
    pub band: Band,
    pub lessons: Vec<LessonOverview>,
    pub assessment: Option<ContentRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DayActivity {
    pub day: String,
    pub attempts: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Overview {
    pub settings: Settings,
    pub units: Vec<UnitOverview>,
    pub continue_session: Option<Id>,
    pub recommended_lesson: Option<ContentRef>,
    pub due_reviews: u32,
    pub total_completed: u32,
    pub today_attempts: u32,
    pub week: Vec<DayActivity>,
    pub tutor_installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ReviewedStep {
    pub activity: ActivityView,
    pub answer: Option<Answer>,
    pub feedback: Option<Feedback>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SessionReview {
    pub session: SessionSnapshot,
    pub steps: Vec<ReviewedStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct TutorThread {
    pub id: Id,
    pub title: String,
    pub source_language: SourceLanguage,
    pub updated_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct TutorTurn {
    pub role: String,
    pub text: String,
    pub explanation: Option<String>,
    pub references: Vec<ContentRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ThreadDetail {
    pub thread: TutorThread,
    pub turns: Vec<TutorTurn>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DownloadItem {
    pub id: String,
    pub title: String,
    pub installed: bool,
    pub bytes: String,
    pub required: bool,
    pub license: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Downloads {
    pub items: Vec<DownloadItem>,
    pub available_bytes: String,
    pub tutor_operation: Option<Id>,
}
