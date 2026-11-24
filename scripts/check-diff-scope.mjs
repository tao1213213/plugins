#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { matchesGlob } from "./lib/glob.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = resolve(ROOT, "schemas/diff-scope-policy.schema.json");

export async function checkDiffScope({ root, base, head, policyPath }) {
  const cwd = resolve(root);
  const errors = [];
  let output;
  try {
    output = execFileSync("git", ["diff", "--name-only", "-z", `${base}...${head}`], {
      cwd,
      encoding: "utf8",
    });
  } catch (error) {
    return { ok: false, errors: [`git diff failed: ${error.message}`], checked: 0 };
  }
  const files = output.split("\0").filter(Boolean).sort();

  let policy;
  try {
    policy = JSON.parse(await readFile(resolve(cwd, policyPath), "utf8"));
  } catch (error) {
    return { ok: false, errors: [`policy unreadable: ${error.message}`], checked: files.length };
  }
  const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  if (!validate(policy)) {
    for (const error of validate.errors ?? []) {
      errors.push(`policy: ${error.instancePath || "/"} ${error.message}`);
    }
    return { ok: false, errors, checked: files.length };
  }

  for (const file of files) {
    if (policy.forbidden.some((pattern) => matchesGlob(file, pattern))) {
      errors.push(`${file}: forbidden by diff scope policy`);
      continue;
    }
    if (!policy.allowed.some((pattern) => matchesGlob(file, pattern))) {
      errors.push(`${file}: outside allowed scope`);
    }
  }

  return { ok: errors.length === 0, errors, checked: files.length };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index === -1 ? fallback : args[index + 1];
  };
  const result = await checkDiffScope({
    root: value("--root", process.cwd()),
    base: value("--base", "origin/main"),
    head: value("--head", "HEAD"),
    policyPath: value("--policy", "diff-scope-policy.json"),
  });
  if (!result.ok) {
    for (const error of result.errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS diff scope checked ${result.checked} files`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
