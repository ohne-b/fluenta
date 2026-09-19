PRAGMA foreign_keys=ON;
PRAGMA user_version=1;
CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE entities(
  id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
  kind TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(id,revision)
) STRICT;
CREATE INDEX entities_kind ON entities(kind,id);
CREATE TABLE unit_overviews(unit_id TEXT PRIMARY KEY,payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
CREATE TABLE relations(
  source_id TEXT NOT NULL, source_revision INTEGER NOT NULL, position INTEGER NOT NULL,
  target_id TEXT NOT NULL, target_revision INTEGER NOT NULL,
  PRIMARY KEY(source_id,source_revision,position),
  FOREIGN KEY(source_id,source_revision) REFERENCES entities(id,revision),
  FOREIGN KEY(target_id,target_revision) REFERENCES entities(id,revision)
) STRICT;
CREATE INDEX relations_target ON relations(target_id,target_revision);
CREATE VIRTUAL TABLE search USING fts5(id UNINDEXED,revision UNINDEXED,kind UNINDEXED,text,tokenize='unicode61 remove_diacritics 2');
