#!/usr/bin/env node
import { run } from "./cli.js";

process.exitCode = await run({
	argv: process.argv.slice(2),
	stdout: { write: (text) => void process.stdout.write(text) },
	stderr: { write: (text) => void process.stderr.write(text) },
});
