#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CODE_FILE = /\.(?:cjs|js|jsx|mjs|py|ts|tsx)$/i;

async function main() {
  const args = process.argv.slice(2);
  const root = args.includes("--root") ? resolve(args[args.indexOf("--root") + 1]) : process.cwd();
  const outputIndex = args.indexOf("--output");
  const output = outputIndex === -1 ? undefined : resolve(args[outputIndex + 1]);
  try {
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
    let bytes = 0;
    let codeFiles = 0;
    let scriptTestFiles = 0;
    for (const file of files) {
      bytes += (await stat(resolve(root, file))).size;
      if (CODE_FILE.test(file)) codeFiles += 1;
      if (file.startsWith("scripts/test/") && /\.test\.mjs$/.test(file)) scriptTestFiles += 1;
    }
    const report = {
      schema_version: "1.0",
      status: "ok",
      metrics: {
        tracked_files: files.length,
        code_files: codeFiles,
        script_test_files: scriptTestFiles,
        repository_bytes: bytes,
      },
    };
    const rendered = `${JSON.stringify(report, null, 2)}\n`;
    if (output) await writeFile(output, rendered);
    else process.stdout.write(rendered);
  } catch (error) {
    const report = { schema_version: "1.0", status: "inconclusive", metrics: {}, error: String(error) };
    const rendered = `${JSON.stringify(report, null, 2)}\n`;
    if (output) await writeFile(output, rendered);
    else process.stdout.write(rendered);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
