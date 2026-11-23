/** Stable generic identities alongside the existing GitHub detail tables. */
export const sql = `
CREATE TABLE sources (
 id TEXT PRIMARY KEY,
 provider TEXT NOT NULL,
 locator TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1,
 UNIQUE(provider, locator)
) STRICT;
CREATE TABLE source_items (
 id TEXT PRIMARY KEY,
 source_id TEXT NOT NULL REFERENCES sources(id),
 kind TEXT NOT NULL,
 external_id TEXT NOT NULL,
 title TEXT NOT NULL,
 url TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'unknown',
 outcome TEXT NOT NULL DEFAULT 'unknown',
 available INTEGER NOT NULL DEFAULT 0,
 verified_at TEXT,
 reopened_at TEXT,
 UNIQUE(source_id, kind, external_id)
) STRICT;
INSERT INTO sources (id, provider, locator)
 SELECT lower(hex(randomblob(16))), 'github', repository FROM items GROUP BY repository;
INSERT INTO source_items (id, source_id, kind, external_id, title, url, state)
 SELECT lower(hex(randomblob(16))), s.id, i.kind, CAST(i.number AS TEXT), i.title, i.url,
 CASE WHEN i.closed_at IS NULL THEN 'open' ELSE 'closed' END
 FROM items i JOIN sources s ON s.provider = 'github' AND s.locator = i.repository;
CREATE TRIGGER github_item_insert AFTER INSERT ON items BEGIN
 INSERT INTO sources (id, provider, locator) VALUES (lower(hex(randomblob(16))), 'github', NEW.repository)
 ON CONFLICT(provider, locator) DO NOTHING;
 INSERT INTO source_items (id, source_id, kind, external_id, title, url)
 SELECT lower(hex(randomblob(16))), id, NEW.kind, CAST(NEW.number AS TEXT), NEW.title, NEW.url
 FROM sources WHERE provider = 'github' AND locator = NEW.repository
 ON CONFLICT(source_id, kind, external_id) DO UPDATE SET title = excluded.title, url = excluded.url;
END;
CREATE TRIGGER github_item_update AFTER UPDATE OF title, url ON items BEGIN
 UPDATE source_items SET title = NEW.title, url = NEW.url
 WHERE source_id = (SELECT id FROM sources WHERE provider = 'github' AND locator = NEW.repository)
 AND kind = NEW.kind AND external_id = CAST(NEW.number AS TEXT);
END;
CREATE TRIGGER github_item_delete AFTER DELETE ON items BEGIN
 DELETE FROM source_items WHERE source_id = (SELECT id FROM sources WHERE provider = 'github' AND locator = OLD.repository)
 AND kind = OLD.kind AND external_id = CAST(OLD.number AS TEXT);
END;
CREATE TABLE tasks (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 stage TEXT NOT NULL DEFAULT 'todo' CHECK(stage IN ('todo', 'doing', 'done', 'blocked')),
 planned_date TEXT,
 deadline TEXT,
 note TEXT NOT NULL DEFAULT '',
 position INTEGER NOT NULL,
 completion_item_id TEXT REFERENCES source_items(id) ON DELETE SET NULL,
 completion_mode TEXT NOT NULL DEFAULT 'successful' CHECK(completion_mode IN ('successful', 'any')),
 completed_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE task_items (
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 item_id TEXT NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
 PRIMARY KEY(task_id, item_id)
) STRICT;
CREATE INDEX task_items_by_item ON task_items(item_id);
CREATE TABLE task_suggestions (
 id TEXT PRIMARY KEY,
 item_ids TEXT NOT NULL,
 suggestions TEXT,
 accepted TEXT NOT NULL DEFAULT '[]'
) STRICT;
`;
