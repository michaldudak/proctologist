import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrations } from "./migrations/index.js";
import { openStore } from "./store.js";

const REPO = "owner/thing";
const NOW = "2026-09-09T12:00:00.000Z";

let directory: string;
let file: string;

beforeEach(async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "proctologist-migrations-"));
	file = path.join(directory, "data.sqlite");
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

/** Builds a database as it stood at `upTo`, the way an installed copy of that version left it. */
function databaseAt(upTo: number): void {
	const db = new Database(file);
	db.pragma("foreign_keys = ON");
	db.exec(`
		CREATE TABLE schema_migrations (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TEXT NOT NULL
		) STRICT
	`);
	const record = db.prepare(
		"INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
	);
	for (const migration of migrations.filter((candidate) => candidate.id <= upTo)) {
		db.exec(migration.sql);
		record.run(migration.id, migration.name, NOW);
	}
	db.close();
}

function seedVersion8(): void {
	const db = new Database(file);
	db.pragma("foreign_keys = ON");
	db.prepare(
		`INSERT INTO pull_requests (
			repository, kind, number, title, url, author, is_bot, authored_by_user,
			review_requested_from_user, created_at, updated_at, is_draft, labels, head_sha, base_ref,
			additions, deletions, changed_files, mergeable, review_decision, checks,
			last_activity_by, last_activity_at, closed_at, fetched_at, author_association
		) VALUES (
			@repository, 'pull_request', 7, 'A title', 'https://example.test/7', 'someone', 0, 0,
			0, @now, @now, 0, '[]', 'abc123', 'main', 1, 2, 3, NULL, NULL, '{}',
			NULL, @now, NULL, @now, 'CONTRIBUTOR'
		)`,
	).run({ repository: REPO, now: NOW });
	db.prepare(
		`INSERT INTO assessments (repository, kind, number, depth, head_sha, updated_at_seen, created_at)
		 VALUES (?, 'pull_request', 7, 'quick', 'abc123', ?, ?)`,
	).run(REPO, NOW, NOW);
	db.prepare(
		"INSERT INTO notes (repository, kind, number, text, updated_at) VALUES (?, 'pull_request', 7, 'mine', ?)",
	).run(REPO, NOW);
	db.prepare(
		"INSERT INTO snoozes (repository, kind, number, created_at) VALUES (?, 'pull_request', 7, ?)",
	).run(REPO, NOW);
	db.prepare(
		`INSERT INTO review_drafts (repository, kind, number, head_sha, summary, verdict, findings, created_at)
		 VALUES (?, 'pull_request', 7, 'abc123', 'a summary', 'comment', '[]', ?)`,
	).run(REPO, NOW);
	db.close();
}

describe("one items table (ADR 0008)", () => {
	it("carries pull requests and everything hanging off them across the rebuild", () => {
		databaseAt(8);
		seedVersion8();

		const store = openStore(file, { createDirectory: false });
		try {
			const stored = store.items.get({ repository: REPO, number: 7 });
			expect(stored?.title).toBe("A title");
			expect(stored?.headSha).toBe("abc123");
			expect(stored?.authorAssociation).toBe("CONTRIBUTOR");

			// The rebuild drops the old table. With foreign keys on that is an implicit delete, and
			// ON DELETE CASCADE would take all four of these with it.
			expect(store.assessments.history({ repository: REPO, number: 7 })).toHaveLength(1);
			expect(store.notes.get({ repository: REPO, number: 7 })?.text).toBe("mine");
			expect(store.snoozes.get({ repository: REPO, number: 7 })).toBeDefined();
			expect(store.reviewDrafts.latest({ repository: REPO, number: 7 })?.summary).toBe("a summary");
		} finally {
			store.close();
		}
	});

	it("leaves the foreign keys pointing at the table that now exists", () => {
		databaseAt(8);
		seedVersion8();

		const store = openStore(file, { createDirectory: false });
		store.close();

		const db = new Database(file);
		try {
			db.pragma("foreign_keys = ON");
			expect(db.pragma("foreign_key_check")).toEqual([]);

			// A cascade that no longer reaches its children would be a silent leak, not an error.
			db.prepare("DELETE FROM items WHERE repository = ? AND number = 7").run(REPO);
			const left = db.prepare("SELECT COUNT(*) AS n FROM assessments").get() as { n: number };
			expect(left.n).toBe(0);
		} finally {
			db.close();
		}
	});

	it("lets an issue leave the pull-request-only columns empty", () => {
		const store = openStore(file, { createDirectory: false });
		try {
			const db = new Database(file);
			db.prepare(
				`INSERT INTO items (
					repository, kind, number, title, url, author, is_bot, author_association,
					authored_by_user, created_at, updated_at, labels, last_activity_at, fetched_at
				) VALUES (?, 'issue', 7, 'An issue', 'https://example.test/i7', 'someone', 0, 'NONE',
					0, ?, ?, '[]', ?, ?)`,
			).run(REPO, NOW, NOW, NOW, NOW);
			const row = db.prepare("SELECT head_sha, is_draft FROM items WHERE kind = 'issue'").get() as {
				head_sha: string | null;
				is_draft: number | null;
			};
			db.close();

			expect(row.head_sha).toBeNull();
			expect(row.is_draft).toBeNull();
		} finally {
			store.close();
		}
	});

	it("keeps an issue and a pull request of the same number apart", () => {
		const store = openStore(file, { createDirectory: false });
		try {
			const db = new Database(file);
			const insert = db.prepare(
				`INSERT INTO items (
					repository, kind, number, title, url, author, is_bot, author_association,
					authored_by_user, created_at, updated_at, labels, last_activity_at, fetched_at
				) VALUES (?, ?, 42, ?, 'https://example.test/42', 'someone', 0, 'NONE',
					0, ?, ?, '[]', ?, ?)`,
			);
			insert.run(REPO, "pull_request", "The pull request", NOW, NOW, NOW, NOW);
			insert.run(REPO, "issue", "The issue", NOW, NOW, NOW, NOW);
			db.close();

			// list() filters on kind; before one table it never had to.
			const listed = store.items.list(REPO);
			expect(listed).toHaveLength(1);
			expect(listed[0]?.title).toBe("The pull request");
		} finally {
			store.close();
		}
	});
});
