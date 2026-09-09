#!/usr/bin/env node
// Records real GraphQL responses into the test fixtures, scrubbing anything identifying.
//
//   node scripts/record-github-fixtures.mjs <owner/name> <pull request number> [output dir]
//
// Run `pnpm typecheck` first: the script imports the queries from the built output.
//
// The output is meant to be reviewed by hand before it is committed: scrubbing replaces logins and
// repository names, but pull request titles and bodies are left alone.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	DEFAULT_BRANCH_QUERY,
	OPEN_PULL_REQUESTS_QUERY,
	PULL_REQUEST_BUNDLE_QUERY,
} from "../dist/github/queries.js";

const run = promisify(execFile);

const [repository, numberArg, outputArg] = process.argv.slice(2);
if (!repository || !numberArg) {
	process.stderr.write("usage: record-github-fixtures.mjs <owner/name> <number> [output dir]\n");
	process.exit(2);
}

const [owner, name] = repository.split("/");
const number = Number(numberArg);
const outputDir =
	outputArg ?? path.join(import.meta.dirname, "..", "src", "github", "__fixtures__");

const viewer = JSON.parse((await gh(["api", "user"])).stdout).login;

// Logins are replaced with stable pseudonyms so a fixture never names a real person.
const logins = new Map([[viewer, "maintainer"]]);
let nextContributor = 0;

await mkdir(outputDir, { recursive: true });
await write("user.json", { login: "maintainer" });
await write("DefaultBranch.json", await graphql(DEFAULT_BRANCH_QUERY, { owner, name }));
await write(
	"OpenPullRequests.json",
	await graphql(OPEN_PULL_REQUESTS_QUERY, { owner, name, cursor: null, pageSize: 50 }),
);
await write(
	"PullRequestBundle.json",
	await graphql(PULL_REQUEST_BUNDLE_QUERY, { owner, name, number }),
);

const diff = await gh([
	"api",
	"-H",
	"Accept: application/vnd.github.v3.diff",
	`repos/${repository}/pulls/${number}`,
]);
await writeFile(path.join(outputDir, "diff.txt"), scrubText(diff.stdout), "utf8");

process.stdout.write(`Wrote fixtures to ${outputDir}. Review them before committing.\n`);

async function gh(args, input) {
	return run("gh", args, { input, maxBuffer: 64 * 1024 * 1024 });
}

async function graphql(query, variables) {
	const { stdout } = await gh(
		["api", "graphql", "--input", "-"],
		JSON.stringify({ query, variables }),
	);
	return JSON.parse(stdout);
}

async function write(file, value) {
	await writeFile(
		path.join(outputDir, file),
		`${JSON.stringify(scrub(value), null, "\t")}\n`,
		"utf8",
	);
}

function scrub(value) {
	if (Array.isArray(value)) {
		return value.map(scrub);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				// Node ids and avatar URLs identify accounts and are not used by the app.
				.filter(([key]) => key !== "id" && key !== "avatarUrl")
				.map(([key, item]) => [key, key === "login" ? pseudonym(item) : scrub(item)]),
		);
	}
	return typeof value === "string" ? scrubText(value) : value;
}

function scrubText(text) {
	let scrubbed = text.replaceAll(`${owner}/${name}`, "owner/thing");
	for (const [real, fake] of logins) {
		scrubbed = scrubbed.replaceAll(real, fake);
	}
	return scrubbed;
}

function pseudonym(login) {
	if (typeof login !== "string") {
		return login;
	}
	if (!logins.has(login)) {
		nextContributor += 1;
		logins.set(login, login.endsWith("[bot]") ? "a-bot[bot]" : `contributor${nextContributor}`);
	}
	return logins.get(login);
}
