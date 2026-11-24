#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function checkRiskApproval({ root, operation, approvalPath, asOf }) {
  const approval = JSON.parse(await readFile(resolve(root, approvalPath), "utf8"));
  const schema = JSON.parse(readFileSync(resolve(ROOT, "schemas/risk-approval.schema.json"), "utf8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(approval)) return { ok: false, errors: [JSON.stringify(validate.errors)], checked: 0 };
  const errors = [];
  if (approval.operation !== operation) errors.push(`approval operation ${approval.operation} does not match ${operation}`);
  if (approval.expires_at < asOf) errors.push(`approval expired ${approval.expires_at}`);
  return { ok: errors.length === 0, errors, checked: 1 };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    if (index === -1 || !args[index + 1]) throw new Error(`missing ${flag}`);
    return args[index + 1];
  };
  const result = await checkRiskApproval({ root: value("--root"), operation: value("--operation"), approvalPath: value("--approval"), asOf: args.includes("--as-of") ? value("--as-of") : new Date().toISOString().slice(0, 10) });
  if (!result.ok) {
    for (const error of result.errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("PASS risk approval");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
