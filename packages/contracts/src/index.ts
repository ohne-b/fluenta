/* Generated from crates/contracts by npm run contracts. Do not edit. */

/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Id".
 */
export type Id = string;
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "EvidenceScope".
 */
export type EvidenceScope = "spanish" | "source_language";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Language".
 */
export type Language = "de" | "en" | "es";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "RevealPolicy".
 */
export type RevealPolicy = "after_submission" | "on_request" | "after_session";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Skill".
 */
export type Skill =
  "grammar" | "vocabulary" | "reading" | "listening" | "writing" | "speaking";
/**
 * Data for the evaluator/compiler. Never pass this answer-bearing enum to the UI.
 *
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Task".
 */
export type Task =
  | {
      kind: "explanation";
      material: ContentRef;
    }
  | {
      correct_ids: Id[];
      explanation: ContentRef;
      kind: "choice";
      options: OptionItem[];
    }
  | {
      accepted_orders: Id[][];
      explanation: ContentRef;
      items: OptionItem[];
      kind: "order";
    }
  | {
      accepted: string[];
      explanation: ContentRef;
      inputs: InputMode[];
      kind: "short_answer";
      language: Language;
      mistakes: KnownMistake[];
      normalization: Normalization[];
      target: TextTarget;
    }
  | {
      kind: "writing";
      language: Language;
      max_words: number;
      min_words: number;
      rubric: ContentRef;
    }
  | {
      keyboard_alternative: ContentRef;
      kind: "speaking";
      language: Language;
      max_seconds: number;
      rubric: ContentRef;
    };
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "InputMode".
 */
export type InputMode = "keyboard" | "microphone";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Normalization".
 */
export type Normalization =
  | "unicode_nfc"
  | "trim"
  | "collapse_whitespace"
  | "ignore_case"
  | "ignore_terminal_punctuation";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "TextTarget".
 */
export type TextTarget = "orthography" | "sentence_content";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "ActivityUse".
 */
export type ActivityUse = "practice" | "assessment";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Band".
 */
export type Band = "A1" | "A2" | "B1" | "B2";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "SourceLanguage".
 */
export type SourceLanguage = "de" | "en";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "GrammarCategory".
 */
export type GrammarCategory = "verbs" | "nouns" | "sentences";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Block".
 */
export type Block =
  | {
      caption: Text;
      kind: "source_text";
      language: Language;
      text: string;
    }
  | {
      alt: Text;
      caption: Text;
      kind: "image";
      png: number[];
    }
  | {
      caption: Text;
      kind: "recorded_audio";
      synthetic: boolean;
      wav: number[];
    }
  | {
      kind: "audio";
      speech: ContentRef;
    }
  | {
      kind: "paragraph";
      spans: Text[];
    }
  | {
      kind: "heading";
      spans: Text[];
    }
  | {
      kind: "example";
      spans: Text[];
      speech?: ContentRef | null;
    }
  | {
      items: Text[][];
      kind: "list";
    }
  | {
      caption: Text;
      columns: Text[];
      kind: "table";
      rows: Text[][];
    }
  | {
      kind: "reference";
      label: Text;
      target: ContentRef;
    };
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "OperationEvent".
 */
export type OperationEvent =
  | {
      event: "transcript_ready";
      payload: {
        transcript: string;
      };
    }
  | {
      event: "recording_started";
    }
  | {
      event: "recording_ready";
      payload: {
        duration_milliseconds: number;
        recording_id: Id;
        session_id: Id;
        step_id: Id;
      };
    }
  | {
      event: "recognition_ready";
      payload: Recognition;
    }
  | {
      event: "progress";
      payload: {
        completed_bytes: string;
        total_bytes?: string | null;
      };
    }
  | {
      event: "tutor_ready";
      payload: {
        reply: TutorReply;
        thread_id: Id;
      };
    }
  | {
      event: "finished";
    }
  | {
      event: "failed";
      payload: Failure;
    }
  | {
      event: "cancelled";
    };
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "ErrorCode".
 */
export type ErrorCode =
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "unsupported_version"
  | "policy_denied"
  | "permission_denied"
  | "device_unavailable"
  | "no_speech"
  | "worker_unavailable"
  | "insufficient_space"
  | "storage_failure"
  | "download_failure"
  | "integrity_failure"
  | "cancelled";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Command".
 */
export type Command =
  | {
      command: "open_source";
      payload: {
        url: string;
      };
    }
  | {
      command: "connected";
      payload: ConnectedCommand;
    }
  | {
      command: "get_home";
    }
  | {
      command: "get_overview";
    }
  | {
      command: "get_settings";
    }
  | {
      command: "update_settings";
      payload: {
        settings: Settings;
      };
    }
  | {
      command: "get_session_review";
      payload: {
        session_id: Id;
      };
    }
  | {
      command: "abandon_session";
      payload: {
        session_id: Id;
      };
    }
  | {
      command: "list_tutor_threads";
    }
  | {
      command: "get_tutor_thread";
      payload: {
        thread_id: Id;
      };
    }
  | {
      command: "delete_tutor_thread";
      payload: {
        thread_id: Id;
      };
    }
  | {
      command: "get_downloads";
    }
  | {
      command: "remove_tutor";
    }
  | {
      command: "stop_playback";
    }
  | {
      command: "keyboard_alternative";
      payload: {
        context: MutationContext;
      };
    }
  | {
      command: "play_recording";
      payload: {
        recording_id: Id;
      };
    }
  | {
      command: "speak_tutor";
      payload: {
        slow: boolean;
        thread_id: Id;
        turn_index: number;
      };
    }
  | {
      command: "start_tutor_recording";
    }
  | {
      command: "restore_backup";
    }
  | {
      command: "import_courses";
    }
  | {
      command: "list_bookmarks";
      payload: {
        source_language: SourceLanguage;
      };
    }
  | {
      command: "list_grammar";
      payload: {
        source_language: SourceLanguage;
      };
    }
  | {
      command: "get_grammar_help";
      payload: {
        context: MutationContext;
      };
    }
  | {
      command: "toggle_bookmark";
      payload: {
        content: ContentRef;
        source_language: SourceLanguage;
      };
    }
  | {
      command: "select_source_language";
      payload: {
        source_language: SourceLanguage;
      };
    }
  | {
      command: "list_units";
      payload: {
        band: Band;
        cursor?: string | null;
        source_language: SourceLanguage;
      };
    }
  | {
      command: "search_content";
      payload: {
        cursor?: string | null;
        query: string;
        source_language: SourceLanguage;
      };
    }
  | {
      command: "get_lesson";
      payload: {
        content: ContentRef;
        source_language: SourceLanguage;
      };
    }
  | {
      command: "get_reference";
      payload: {
        content: ContentRef;
        source_language: SourceLanguage;
      };
    }
  | {
      command: "start_session";
      payload: {
        mode: SessionMode;
        skill?: Skill | null;
        source_language: SourceLanguage;
        target: ContentRef;
      };
    }
  | {
      command: "resume_session";
      payload: {
        session_id: Id;
      };
    }
  | {
      command: "save_draft";
      payload: {
        answer: Answer;
        context: MutationContext;
        sequence: number;
      };
    }
  | {
      command: "submit_answer";
      payload: SubmitAnswer;
    }
  | {
      command: "advance_session";
      payload: {
        context: MutationContext;
        mutation_id: Id;
      };
    }
  | {
      command: "reveal_hint";
      payload: {
        context: MutationContext;
        mutation_id: Id;
      };
    }
  | {
      command: "start_recording";
      payload: {
        context: MutationContext;
      };
    }
  | {
      command: "stop_recording";
      payload: {
        operation_id: Id;
      };
    }
  | {
      command: "synthesize";
      payload: {
        context?: MutationContext | null;
        segment: ContentRef;
        slow: boolean;
      };
    }
  | {
      command: "start_tutor_turn";
      payload: {
        message: string;
        mode: TutorMode;
        session_id?: Id | null;
        thread_id?: Id | null;
      };
    }
  | {
      command: "install_pack";
      payload: {
        release_id: Id;
      };
    }
  | {
      command: "cancel_operation";
      payload: {
        operation_id: Id;
      };
    }
  | {
      command: "read_operation";
      payload: {
        after_sequence: number;
        operation_id: Id;
      };
    }
  | {
      command: "create_backup";
    };
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "ConnectedCommand".
 */
export type ConnectedCommand =
  | {
      action: "today";
    }
  | {
      action: "interests";
      topics: Id[];
    }
  | {
      action: "words";
    }
  | {
      action: "lookup";
      context?: MutationContext | null;
      occurrence: ContentRef;
      opened: boolean;
    }
  | {
      action: "learn_word";
      context?: MutationContext | null;
      occurrence: ContentRef;
    }
  | {
      action: "update_word";
      notes: string;
      sense: ContentRef;
      status: WordStatus;
    }
  | {
      action: "start_mission";
      mission: ContentRef;
      support: SupportLevel;
    }
  | {
      action: "review_words";
      production: boolean;
      sense?: ContentRef | null;
    }
  | {
      action: "recap";
      session_id: Id;
    }
  | {
      action: "productions";
    }
  | {
      action: "revise";
      answer: Answer;
      criteria: {
        [k: string]: SelfReview;
      };
      step_id: Id;
    }
  | {
      action: "notebook";
    }
  | {
      action: "save_argument";
      counterargument: string;
      id?: Id | null;
      source: ContentRef;
      text: string;
    }
  | {
      action: "delete_argument";
      id: Id;
    };
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "WordStatus".
 */
export type WordStatus = "recent" | "active" | "paused" | "archived";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "SupportLevel".
 */
export type SupportLevel = "learn" | "independent" | "rehearsal";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Answer".
 */
export type Answer =
  | {
      kind: "acknowledged";
    }
  | {
      kind: "choice";
      selected_ids: Id[];
    }
  | {
      kind: "order";
      ordered_ids: Id[];
    }
  | {
      kind: "typed";
      text: string;
    }
  | {
      confirmed_text: string;
      kind: "voice";
      recognition_id: Id;
    }
  | {
      kind: "writing";
      text: string;
    }
  | {
      kind: "recording";
      recording_id: Id;
    };
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "SelfReview".
 */
export type SelfReview = "met" | "developing" | "not_assessed";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Theme".
 */
export type Theme = "system" | "light" | "dark";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "SessionMode".
 */
export type SessionMode = "lesson" | "review" | "focused_practice" | "test";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "TutorMode".
 */
export type TutorMode = "conversation" | "explain" | "writing_feedback";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "ResponseResult".
 */
export type ResponseResult =
  | {
      payload: Success;
      status: "ok";
    }
  | {
      payload: Failure;
      status: "error";
    };
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Success".
 */
export type Success =
  | {
      data: ConnectedResponse;
      kind: "connected";
    }
  | {
      data: HomeView;
      kind: "home";
    }
  | {
      data: Overview;
      kind: "overview";
    }
  | {
      data: Settings;
      kind: "settings";
    }
  | {
      data: SessionReview;
      kind: "session_review";
    }
  | {
      data: TutorThread[];
      kind: "tutor_threads";
    }
  | {
      data: ThreadDetail;
      kind: "tutor_thread";
    }
  | {
      data: Downloads;
      kind: "downloads";
    }
  | {
      data: SearchHit[];
      kind: "bookmarks";
    }
  | {
      data: Lesson;
      kind: "lesson";
    }
  | {
      data: Material;
      kind: "reference";
    }
  | {
      data: GrammarTopic[];
      kind: "grammar";
    }
  | {
      data: Material[];
      kind: "grammar_help";
    }
  | {
      data: {
        items: Unit[];
        next_cursor?: string | null;
      };
      kind: "units";
    }
  | {
      data: {
        items: SearchHit[];
        next_cursor?: string | null;
      };
      kind: "search";
    }
  | {
      data: SessionSnapshot;
      kind: "session";
    }
  | {
      data: {
        accepted_sequence: number;
      };
      kind: "draft_saved";
    }
  | {
      data: {
        material: Material;
        session: SessionSnapshot;
      };
      kind: "hint";
    }
  | {
      data: {
        operation_id: Id;
      };
      kind: "operation_started";
    }
  | {
      data: {
        items: Event[];
        last_sequence: number;
        terminal: boolean;
      };
      kind: "operation_events";
    }
  | {
      kind: "accepted";
    };
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "ConnectedResponse".
 */
export type ConnectedResponse =
  | {
      data: DailyPlan;
      kind: "today";
    }
  | {
      data: WordView[];
      kind: "words";
    }
  | {
      data: WordView;
      kind: "word";
    }
  | {
      data: SessionSnapshot;
      kind: "session";
    }
  | {
      data: MissionRecap;
      kind: "recap";
    }
  | {
      data: ProductionRecord[];
      kind: "productions";
    }
  | {
      data: NotebookEntry[];
      kind: "notebook";
    }
  | {
      kind: "accepted";
    };
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "SessionState".
 */
export type SessionState =
  | {
      state: "active";
      step: ActiveStep;
    }
  | {
      state: "completed";
      summary: SessionSummary;
    }
  | {
      state: "abandoned";
    };
/**
 * Answer-free projection. Solutions remain in Rust until reveal is permitted.
 *
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "TaskView".
 */
export type TaskView =
  | {
      kind: "explanation";
      material: ContentRef;
    }
  | {
      kind: "choice";
      multiple: boolean;
      options: OptionItem[];
    }
  | {
      items: OptionItem[];
      kind: "order";
    }
  | {
      inputs: InputMode[];
      kind: "short_answer";
      language: Language;
      target: TextTarget;
    }
  | {
      kind: "writing";
      language: Language;
      max_words: number;
      min_words: number;
    }
  | {
      keyboard_alternative: ContentRef;
      kind: "speaking";
      language: Language;
      max_seconds: number;
    };
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Evidence".
 */
export type Evidence =
  | "none"
  | "unaided_recall"
  | "assisted_recall"
  | "recognized_content"
  | "edited_transcript"
  | "self_assessment";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Outcome".
 */
export type Outcome =
  | "correct"
  | "incorrect"
  | "completed"
  | "needs_self_review"
  | "deferred_until_recap";
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "StepPhase".
 */
export type StepPhase = "answering" | "feedback";
/**
 * Contributor build only. These are not registered commands in the learner app.
 *
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "StudioRequest".
 */
export type StudioRequest =
  | {
      command: "current";
    }
  | {
      command: "open";
    }
  | {
      command: "read";
      path: string;
    }
  | {
      command: "save";
      expected_sha256: string;
      path: string;
      text: string;
    }
  | {
      command: "validate";
    };
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "StudioResponse".
 */
export type StudioResponse =
  | {
      files: string[];
      kind: "workspace";
      root: string;
    }
  | {
      kind: "document";
      path: string;
      sha256: string;
      text: string;
    }
  | {
      kind: "validated";
      packs: number;
      units: UnitOverview[];
    }
  | {
      kind: "cancelled";
    };

export interface Protocol {
  course_pack: CoursePack;
  event: Event;
  request: Request;
  response: Response;
  studio_request: StudioRequest;
  studio_response: StudioResponse;
  tutor_context: TutorContext;
}
/**
 * Complete compiled content fixture. Real packs keep these records in indexed SQLite.
 *
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "CoursePack".
 */
export interface CoursePack {
  activities: Activity[];
  assessments?: Assessment[];
  course: Course;
  grammar?: GrammarTopic[];
  lessons: Lesson[];
  materials: Material[];
  missions?: Mission[];
  objectives: Objective[];
  occurrences?: Occurrence[];
  release_id: Id;
  rubrics: Rubric[];
  schema_version: number;
  speech: SpeechSegment[];
  topics?: Topic[];
  units: Unit[];
  vocabulary: LexicalSense[];
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Activity".
 */
export interface Activity {
  content: ContentRef;
  evidence_scope?: EvidenceScope;
  hints: ContentRef[];
  instruction: Text;
  lexical?: LexicalPractice[];
  materials: ContentRef[];
  objectives: ContentRef[];
  preparation?: boolean;
  reveal_policy: RevealPolicy;
  skills?: Skill[];
  task: Task;
  usage?: ActivityUse;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "ContentRef".
 */
export interface ContentRef {
  id: Id;
  revision: number;
}
/**
 * Fully resolved source-language teaching material, never executable markup.
 *
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Text".
 */
export interface Text {
  annotations?: Annotation[];
  language: Language;
  text: string;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Annotation".
 */
export interface Annotation {
  end: number;
  occurrence: ContentRef;
  /**
   * Unicode scalar offsets, not bytes or UTF-16 code units.
   */
  start: number;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "LexicalPractice".
 */
export interface LexicalPractice {
  occurrence: ContentRef;
  sense: ContentRef;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "OptionItem".
 */
export interface OptionItem {
  id: Id;
  label: Text;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "KnownMistake".
 */
export interface KnownMistake {
  answers: string[];
  feedback: ContentRef;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Assessment".
 */
export interface Assessment {
  activities: ContentRef[];
  audio_replays: number;
  content: ContentRef;
  duration_seconds: number;
  title: Text;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Course".
 */
export interface Course {
  band: Band;
  content: ContentRef;
  source_language: SourceLanguage;
  title: Text;
  units: ContentRef[];
}
/**
 * A grammar course links canonical explanations to lessons that apply them.
 *
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "GrammarTopic".
 */
export interface GrammarTopic {
  band: Band;
  category: GrammarCategory;
  content: ContentRef;
  explanations: ContentRef[];
  group?: Text | null;
  lessons: ContentRef[];
  order?: number;
  summary: Text;
  title: Text;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Lesson".
 */
export interface Lesson {
  activities: ContentRef[];
  content: ContentRef;
  estimated_minutes: number;
  objectives: ContentRef[];
  title: Text;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Material".
 */
export interface Material {
  blocks: Block[];
  content: ContentRef;
  searchable?: boolean;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Mission".
 */
export interface Mission {
  attribution: Text;
  band: Band;
  challenge: ContentRef;
  content: ContentRef;
  description: Text;
  lesson: ContentRef;
  order: number;
  outcome: Text;
  question: Text;
  sources: Source[];
  title: Text;
  vocabulary: ContentRef[];
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Source".
 */
export interface Source {
  accessed: string;
  note: Text;
  title: string;
  url: string;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Objective".
 */
export interface Objective {
  band: Band;
  can_do: Text;
  content: ContentRef;
  explanation_refs: ContentRef[];
  grammar_topics?: Id[];
  prerequisites: ContentRef[];
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Occurrence".
 */
export interface Occurrence {
  content: ContentRef;
  context: Text;
  meaning: Text;
  owner: ContentRef;
  sense: ContentRef;
  speech?: ContentRef | null;
  surface: string;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Rubric".
 */
export interface Rubric {
  content: ContentRef;
  criteria: RubricCriterion[];
  model_answers: ContentRef[];
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "RubricCriterion".
 */
export interface RubricCriterion {
  guidance: Text;
  id: Id;
  label: Text;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "SpeechSegment".
 */
export interface SpeechSegment {
  content: ContentRef;
  pronunciation_override?: string | null;
  speaker_role?: Id | null;
  text: string;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Topic".
 */
export interface Topic {
  content: ContentRef;
  description: Text;
  missions: ContentRef[];
  outcomes: Text[];
  question: Text;
  sources: Source[];
  title: Text;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Unit".
 */
export interface Unit {
  assessment?: ContentRef | null;
  content: ContentRef;
  lessons: ContentRef[];
  objectives: ContentRef[];
  title: Text;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "LexicalSense".
 */
export interface LexicalSense {
  accepted_forms: string[];
  content: ContentRef;
  examples: ContentRef[];
  gloss: Text;
  grammar?: Text | null;
  lemma: string;
  part_of_speech: string;
  practice?: ContentRef[];
  topics?: Id[];
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Event".
 */
export interface Event {
  event: OperationEvent;
  operation_id: Id;
  sequence: number;
  session_id?: Id | null;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Recognition".
 */
export interface Recognition {
  language: Language;
  recognition_id: Id;
  session_id: Id;
  step_id: Id;
  transcript: string;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "TutorReply".
 */
export interface TutorReply {
  explanation_native: string;
  reference_ids: Id[];
  reply_es: string;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Failure".
 */
export interface Failure {
  code: ErrorCode;
  message_key: string;
  retryable: boolean;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Request".
 */
export interface Request {
  command: Command;
  protocol_version: number;
  request_id: Id;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "MutationContext".
 */
export interface MutationContext {
  expected_step_version: number;
  session_id: Id;
  step_id: Id;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Settings".
 */
export interface Settings {
  audio_enabled: boolean;
  daily_minutes: number;
  onboarding_complete: boolean;
  source_language: SourceLanguage;
  starting_band: Band;
  theme: Theme;
  ui_language: SourceLanguage;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "SubmitAnswer".
 */
export interface SubmitAnswer {
  answer: Answer;
  context: MutationContext;
  submission_id: Id;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Response".
 */
export interface Response {
  protocol_version: number;
  request_id: Id;
  result: ResponseResult;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "DailyPlan".
 */
export interface DailyPlan {
  due: number;
  independent_words: number;
  interests: Id[];
  minutes: number;
  new_word_limit: number;
  recommended?: MissionView | null;
  review_limit: number;
  topics: TopicView[];
  unseen_tasks: number;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "MissionView".
 */
export interface MissionView {
  challenge_seen: boolean;
  completed: boolean;
  minutes: number;
  mission: Mission;
  resume?: Id | null;
  unseen_completed: boolean;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "TopicView".
 */
export interface TopicView {
  missions: MissionView[];
  topic: Topic;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "WordView".
 */
export interface WordView {
  assisted_recall: number;
  contexts: Occurrence[];
  due_ms?: number | null;
  independent_recall: number;
  notes: string;
  productive_attempts: number;
  sense: LexicalSense;
  spelling_recall: number;
  spoken_recognition: number;
  status: WordStatus;
  understanding: number;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "SessionSnapshot".
 */
export interface SessionSnapshot {
  deadline_ms?: number | null;
  mode: SessionMode;
  policy: SessionPolicy;
  release_id: Id;
  session: SessionState;
  session_id: Id;
  source_language: SourceLanguage;
  step_count: number;
  version: number;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "SessionPolicy".
 */
export interface SessionPolicy {
  audio_replays?: number | null;
  hints_allowed: boolean;
  reveal: RevealPolicy;
  time_limit_seconds?: number | null;
  tutor_allowed: boolean;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "ActiveStep".
 */
export interface ActiveStep {
  activity: ActivityView;
  audio_plays: number;
  draft?: Answer | null;
  draft_sequence: number;
  feedback?: Feedback | null;
  index: number;
  phase: StepPhase;
  step_id: Id;
  version: number;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "ActivityView".
 */
export interface ActivityView {
  content: ContentRef;
  hints_remaining: number;
  instruction: Text;
  task: TaskView;
  visible_materials: Material[];
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Feedback".
 */
export interface Feedback {
  evidence: Evidence;
  explanation?: Material | null;
  message?: Text | null;
  outcome: Outcome;
  rubric?: Rubric | null;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "SessionSummary".
 */
export interface SessionSummary {
  completed_steps: number;
  correct_unaided: number;
  needs_review: ContentRef[];
  objectively_marked: number;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "MissionRecap".
 */
export interface MissionRecap {
  mission?: Mission | null;
  productions: ProductionRecord[];
  suggestions: WordView[];
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "ProductionRecord".
 */
export interface ProductionRecord {
  activity: ActivityView;
  assisted: boolean;
  context: MutationContext;
  created_ms: number;
  feedback: Feedback;
  original: Answer;
  revisions: Revision[];
  session_id: Id;
  step_id: Id;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Revision".
 */
export interface Revision {
  answer: Answer;
  created_ms: number;
  /**
   * Self-review only: met / developing / not_assessed. Never an automatic grade.
   */
  criteria: {
    [k: string]: SelfReview;
  };
  id: Id;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "NotebookEntry".
 */
export interface NotebookEntry {
  counterargument: string;
  created_ms: number;
  id: Id;
  source: ContentRef;
  source_title: string;
  text: string;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "HomeView".
 */
export interface HomeView {
  continue_session_id?: Id | null;
  due_reviews: number;
  recommended_lesson?: ContentRef | null;
  source_language: SourceLanguage;
  tutor_installed: boolean;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Overview".
 */
export interface Overview {
  continue_session?: Id | null;
  due_reviews: number;
  recommended_lesson?: ContentRef | null;
  settings: Settings;
  today_attempts: number;
  total_completed: number;
  tutor_installed: boolean;
  units: UnitOverview[];
  week: DayActivity[];
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "UnitOverview".
 */
export interface UnitOverview {
  assessment?: ContentRef | null;
  band: Band;
  content: ContentRef;
  lessons: LessonOverview[];
  title: Text;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "LessonOverview".
 */
export interface LessonOverview {
  activity_count: number;
  completed: boolean;
  content: ContentRef;
  estimated_minutes: number;
  objectives: ContentRef[];
  skills: string[];
  title: Text;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "DayActivity".
 */
export interface DayActivity {
  attempts: number;
  day: string;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "SessionReview".
 */
export interface SessionReview {
  session: SessionSnapshot;
  steps: ReviewedStep[];
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "ReviewedStep".
 */
export interface ReviewedStep {
  activity: ActivityView;
  answer?: Answer | null;
  feedback?: Feedback | null;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "TutorThread".
 */
export interface TutorThread {
  id: Id;
  source_language: SourceLanguage;
  title: string;
  updated_ms: number;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "ThreadDetail".
 */
export interface ThreadDetail {
  thread: TutorThread;
  turns: TutorTurn[];
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "TutorTurn".
 */
export interface TutorTurn {
  explanation?: string | null;
  references: ContentRef[];
  role: string;
  text: string;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "Downloads".
 */
export interface Downloads {
  available_bytes: string;
  items: DownloadItem[];
  tutor_operation?: Id | null;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "DownloadItem".
 */
export interface DownloadItem {
  bytes: string;
  id: string;
  installed: boolean;
  license: string;
  required: boolean;
  title: string;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "SearchHit".
 */
export interface SearchHit {
  content: ContentRef;
  excerpt: Text;
  title: Text;
}
/**
 * Constructed by the backend. The UI cannot supply or extend this whitelist.
 *
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "TutorContext".
 */
export interface TutorContext {
  band: Band;
  mode: TutorMode;
  objective?: ContentRef | null;
  references: ReferenceExcerpt[];
  solution_revealed: boolean;
  source_language: SourceLanguage;
  submitted_answer?: Answer | null;
  visible_task?: ActivityView | null;
}
/**
 * This interface was referenced by `Protocol`'s JSON-Schema
 * via the `definition` "ReferenceExcerpt".
 */
export interface ReferenceExcerpt {
  content: ContentRef;
  text: Text;
}
