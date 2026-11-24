#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { assertPathWithin } from "./lib/isolated-workspace.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = resolve(ROOT, "schemas/evidence-manifest.schema.json");

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function validateEvidence({ root, manifestPath }) {
  const base = resolve(root);
  const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  const value = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  const errors = [];

  if (!validate(value)) {
    for (const error of validate.errors ?? []) {
      errors.push(`${error.instancePath || "/"} ${error.message}`);
    }
    return { ok: false, errors, checked: 0 };
  }

  const ids = new Set();
  for (const claim of value.claims) {
    if (ids.has(claim.claim_id)) errors.push(`duplicate claim id ${claim.claim_id}`);
    ids.add(claim.claim_id);

    if (claim.status === "passed" && claim.exit_code !== 0) {
      errors.push(`${claim.claim_id}: passed claim must have exit_code 0`);
    }
    if (claim.status === "failed" && claim.exit_code === 0) {
      errors.push(`${claim.claim_id}: failed claim must have a non-zero exit_code`);
    }
    if (claim.negative_control.failing_claim !== claim.claim_id) {
      errors.push(`${claim.claim_id}: negative control failing_claim must match claim_id`);
    }

    for (const artifact of claim.artifacts) {
      const artifactPath = resolve(base, artifact.path);
      try {
        assertPathWithin(base, artifactPath);
      } catch (error) {
        errors.push(`${claim.claim_id}: artifact path escapes evidence root: ${artifact.path}`);
        continue;
      }
      let bytes;
      try {
        bytes = await readFile(artifactPath);
      } catch {
        errors.push(`${claim.claim_id}: artifact not found: ${artifact.path}`);
        continue;
      }
      if (digest(bytes) !== artifact.sha256) {
        errors.push(`${claim.claim_id}: artifact sha256 mismatch: ${artifact.path}`);
      }
    }
  }

  const counts = { passed: 0, failed: 0, skipped: 0, unreachable: 0 };
  for (const claim of value.claims) counts[claim.status] += 1;
  const expected = {
    total: value.claims.length + value.coverage.uncovered,
    verified: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    unreachable: counts.unreachable,
  };
  for (const [key, wanted] of Object.entries(expected)) {
    if (value.coverage[key] !== wanted) {
      errors.push(`coverage.${key} expected ${wanted}, got ${value.coverage[key]}`);
    }
  }
  const summed = Object.entries(value.coverage)
    .filter(([key]) => key !== "total")
    .reduce((total, [, count]) => total + count, 0);
  if (summed !== value.coverage.total) {
    errors.push(`coverage counts sum to ${summed}, total is ${value.coverage.total}`);
  }

  return { ok: errors.length === 0, errors, checked: value.claims.length };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index === -1 ? fallback : args[index + 1];
  };
  const manifestPath = resolve(value("--manifest", "evidence.json"));
  const root = resolve(value("--root", dirname(manifestPath)));
  const result = await validateEvidence({ root, manifestPath });
  if (!result.ok) {
    for (const error of result.errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS validated ${result.checked} evidence claims`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
