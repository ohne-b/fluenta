PRAGMA user_version=1;
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL CHECK(json_valid(value))) STRICT;
CREATE TABLE sessions(
 id TEXT PRIMARY KEY, source_language TEXT NOT NULL CHECK(source_language IN ('de','en')),
 release_id TEXT NOT NULL, target_id TEXT NOT NULL, mode TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, current_index INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK(status IN ('active','completed','abandoned')),
 policy_json TEXT NOT NULL, started_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, deadline_ms INTEGER
) STRICT;
CREATE INDEX sessions_resume ON sessions(status,updated_ms DESC);
CREATE INDEX sessions_completed ON sessions(source_language,status,target_id);
CREATE TABLE session_steps(
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), position INTEGER NOT NULL,
 activity_id TEXT NOT NULL, activity_revision INTEGER NOT NULL,
 view_json TEXT NOT NULL, draft_json TEXT, draft_sequence INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1, phase TEXT NOT NULL DEFAULT 'answering',
 hints_used INTEGER NOT NULL DEFAULT 0, feedback_json TEXT,
 assisted INTEGER NOT NULL DEFAULT 0, audio_plays INTEGER NOT NULL DEFAULT 0,
 UNIQUE(session_id,position)
) STRICT;
CREATE TABLE attempts(
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),step_id TEXT NOT NULL REFERENCES session_steps(id),
 activity_id TEXT NOT NULL,activity_revision INTEGER NOT NULL,source_language TEXT NOT NULL,
 answer_json TEXT NOT NULL,outcome TEXT NOT NULL,evidence TEXT NOT NULL,
 created_ms INTEGER NOT NULL,UNIQUE(step_id)
) STRICT;
CREATE INDEX attempts_recent ON attempts(created_ms);
CREATE INDEX attempts_activity ON attempts(activity_id,source_language);
CREATE TABLE mutations(id TEXT PRIMARY KEY,request_json TEXT NOT NULL,response_json TEXT NOT NULL) STRICT;
CREATE TABLE reviews(
 id TEXT PRIMARY KEY,activity_id TEXT NOT NULL,source_language TEXT NOT NULL,release_id TEXT NOT NULL,
 revision INTEGER NOT NULL,stability REAL NOT NULL,difficulty REAL NOT NULL,due_ms INTEGER NOT NULL,last_review_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX reviews_due ON reviews(source_language,due_ms);
CREATE TABLE review_history(attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),review_id TEXT NOT NULL REFERENCES reviews(id),state_json TEXT NOT NULL) STRICT;
CREATE TABLE recognitions(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),step_id TEXT NOT NULL REFERENCES session_steps(id),transcript TEXT NOT NULL) STRICT;
CREATE TABLE recordings(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),step_id TEXT NOT NULL REFERENCES session_steps(id),path TEXT NOT NULL,duration_ms INTEGER NOT NULL) STRICT;
CREATE TABLE bookmarks(id TEXT NOT NULL,revision INTEGER NOT NULL,source_language TEXT NOT NULL,PRIMARY KEY(id,source_language)) STRICT;
CREATE TABLE tutor_threads(id TEXT PRIMARY KEY,title TEXT NOT NULL,source_language TEXT NOT NULL,updated_ms INTEGER NOT NULL) STRICT;
CREATE TABLE tutor_turns(id INTEGER PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES tutor_threads(id) ON DELETE CASCADE,role TEXT NOT NULL,text TEXT NOT NULL,explanation TEXT,references_json TEXT NOT NULL) STRICT;
CREATE INDEX tutor_turns_thread ON tutor_turns(thread_id,id);
