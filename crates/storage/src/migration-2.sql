-- Existing activity reviews and pinned sessions are intentionally retained.
ALTER TABLE reviews ADD COLUMN sense_id TEXT;
CREATE INDEX reviews_sense ON reviews(source_language,sense_id,due_ms);
CREATE TABLE vocabulary(
  sense_id TEXT NOT NULL, locale TEXT NOT NULL CHECK(locale IN ('de','en')),
  release_id TEXT NOT NULL, sense_json TEXT NOT NULL CHECK(json_valid(sense_json)),
  status TEXT NOT NULL CHECK(status IN ('recent','active','paused','archived')),
  notes TEXT NOT NULL DEFAULT '', created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL,
  PRIMARY KEY(sense_id,locale)
) STRICT;
CREATE TABLE vocabulary_contexts(
  sense_id TEXT NOT NULL, locale TEXT NOT NULL, occurrence_id TEXT NOT NULL,
  occurrence_json TEXT NOT NULL CHECK(json_valid(occurrence_json)), encountered_ms INTEGER NOT NULL,
  PRIMARY KEY(sense_id,locale,occurrence_id),
  FOREIGN KEY(sense_id,locale) REFERENCES vocabulary(sense_id,locale) ON DELETE CASCADE
) STRICT;
CREATE TABLE lexical_evidence(
  attempt_id TEXT NOT NULL REFERENCES attempts(id), sense_id TEXT NOT NULL, locale TEXT NOT NULL,
  occurrence_id TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL,
  skill TEXT NOT NULL CHECK(skill IN ('understanding','recall','spelling','speech','production')),
  PRIMARY KEY(attempt_id,sense_id)
) STRICT;
CREATE INDEX lexical_evidence_sense ON lexical_evidence(locale,sense_id,evidence,skill);
CREATE TABLE mission_sessions(
  session_id TEXT PRIMARY KEY REFERENCES sessions(id), mission_id TEXT NOT NULL,
  support TEXT NOT NULL CHECK(support IN ('learn','independent','rehearsal')),
  unseen INTEGER NOT NULL CHECK(unseen IN (0,1))
) STRICT;
CREATE TABLE output_revisions(
  id TEXT PRIMARY KEY, step_id TEXT NOT NULL REFERENCES session_steps(id),
  answer_json TEXT NOT NULL CHECK(json_valid(answer_json)),
  criteria_json TEXT NOT NULL CHECK(json_valid(criteria_json)), created_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX output_revisions_step ON output_revisions(step_id,created_ms);
CREATE TABLE notebook(
  id TEXT PRIMARY KEY, locale TEXT NOT NULL, source_json TEXT NOT NULL CHECK(json_valid(source_json)),
  source_title TEXT NOT NULL, text TEXT NOT NULL, counterargument TEXT NOT NULL,
  created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL
) STRICT;
PRAGMA user_version=2;
