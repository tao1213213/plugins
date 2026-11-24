#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function checkExceptions({ root, policyPath, asOf }) {
  const policy = JSON.parse(await readFile(resolve(root, policyPath), "utf8"));
  const schema = JSON.parse(readFileSync(resolve(ROOT, "schemas/exceptions.schema.json"), "utf8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(policy)) return { ok: false, errors: [JSON.stringify(validate.errors)], checked: 0 };
  const errors = [];
  for (const exception of policy.exceptions) {
    if (exception.expires_at < asOf) errors.push(`${exception.id}: exception expired ${exception.expires_at}`);
  }
  return { ok: errors.length === 0, errors, checked: policy.exceptions.length };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index === -1 ? fallback : args[index + 1];
  };
  const result = await checkExceptions({ root: value("--root", process.cwd()), policyPath: value("--policy", "exceptions.json"), asOf: value("--as-of", new Date().toISOString().slice(0, 10)) });
  if (!result.ok) {
    for (const error of result.errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS exceptions checked ${result.checked}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
