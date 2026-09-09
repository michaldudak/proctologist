#!/usr/bin/env node
// Stands in for the real `gh` in tests. It serves recorded responses from the directory in
// FAKE_GH_DIR, chosen by the GraphQL operation name, and can be told to fail instead.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const dir = process.env["FAKE_GH_DIR"];
if (!dir) {
	process.stderr.write("FAKE_GH_DIR is not set\n");
	process.exit(2);
}

const fail = file("fail.json");
if (fail) {
	const { stderr = "", stdout = "", code = 1 } = JSON.parse(fail);
	process.stdout.write(stdout);
	process.stderr.write(stderr);
	process.exit(code);
}

const args = process.argv.slice(2);

if (args[0] !== "api") {
	process.stderr.write(`fake gh does not know "${args.join(" ")}"\n`);
	process.exit(2);
}

if (args.includes("user")) {
	write("user.json");
} else if (args.includes("graphql")) {
	const body = JSON.parse(await readStdin());
	const operation = /query (\w+)/.exec(body.query)?.[1];
	const page = body.variables?.cursor ? `.${2}` : "";
	write(`${operation}${page}.json`);
} else if (args.some((arg) => /^repos\/.+\/pulls\/\d+$/.test(arg))) {
	write("diff.txt");
} else {
	process.stderr.write(`fake gh does not know "${args.join(" ")}"\n`);
	process.exit(2);
}

function file(name) {
	const full = path.join(dir, name);
	return existsSync(full) ? readFileSync(full, "utf8") : undefined;
}

function write(name) {
	const contents = file(name);
	if (contents === undefined) {
		process.stderr.write(`fake gh has no fixture ${name}\n`);
		process.exit(2);
	}
	process.stdout.write(contents);
}

async function readStdin() {
	let text = "";
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) {
		text += chunk;
	}
	return text;
}
