import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { createAnalysisRepository, type AnalysisRepository } from "./analyses.js";
import { createAssessmentRepository, type AssessmentRepository } from "./assessments.js";
import {
	createNoteRepository,
	createSnoozeRepository,
	type NoteRepository,
	type SnoozeRepository,
} from "./annotations.js";
import { createJobRepository, type JobRepository } from "./jobs.js";
import { migrations } from "./migrations/index.js";
import { createPullRequestRepository, type PullRequestRepository } from "./pull-requests.js";
import { createRefreshRepository, type RefreshRepository } from "./refreshes.js";
import { createReviewDraftRepository, type ReviewDraftRepository } from "./review-drafts.js";
import { StoreError } from "./types.js";

export interface Store {
	pullRequests: PullRequestRepository;
	assessments: AssessmentRepository;
	analyses: AnalysisRepository;
	notes: NoteRepository;
	snoozes: SnoozeRepository;
	reviewDrafts: ReviewDraftRepository;
	jobs: JobRepository;
	refreshes: RefreshRepository;
	/** Runs `work` in one SQLite transaction, rolling back if it throws. */
	transaction: <T>(work: () => T) => T;
	/** The schema version the database is now at. */
	schemaVersion: number;
	close: () => void;
}

export interface OpenStoreOptions {
	/** Set to false to skip creating the parent directory, for `:memory:` databases. */
	createDirectory?: boolean;
}

/**
 * Opens the database, applying any migrations the file has not seen. WAL keeps the desktop app
 * readable while the CLI writes.
 */
export function openStore(file: string, options: OpenStoreOptions = {}): Store {
	if (file !== ":memory:" && options.createDirectory !== false) {
		mkdirSync(path.dirname(file), { recursive: true });
	}

	let db: Database.Database;
	try {
		db = new Database(file);
	} catch (cause) {
		throw new StoreError(`Could not open the database at ${file}`, { cause });
	}

	db.pragma("journal_mode = WAL");
	db.pragma("busy_timeout = 5000");
	db.pragma("foreign_keys = ON");
	db.pragma("synchronous = NORMAL");

	const schemaVersion = migrate(db);

	return {
		pullRequests: createPullRequestRepository(db),
		assessments: createAssessmentRepository(db),
		analyses: createAnalysisRepository(db),
		notes: createNoteRepository(db),
		snoozes: createSnoozeRepository(db),
		reviewDrafts: createReviewDraftRepository(db),
		jobs: createJobRepository(db),
		refreshes: createRefreshRepository(db),
		transaction: <T>(work: () => T): T => db.transaction(work)(),
		schemaVersion,
		close: () => {
			db.close();
		},
	};
}

function migrate(db: Database.Database): number {
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TEXT NOT NULL
		) STRICT
	`);

	const applied = new Set(
		(db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map((row) => row.id),
	);
	const record = db.prepare(
		"INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
	);

	for (const migration of migrations) {
		if (applied.has(migration.id)) {
			continue;
		}
		try {
			db.transaction(() => {
				db.exec(migration.sql);
				record.run(migration.id, migration.name, new Date().toISOString());
			})();
		} catch (cause) {
			throw new StoreError(
				`Migration ${migration.id} (${migration.name}) failed; the database was left unchanged`,
				{ cause },
			);
		}
	}

	const latest = migrations.at(-1);
	return latest ? latest.id : 0;
}
