#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const NOTES = [
  { id: 1, title: "Quarterly plan", body: "Draft budget" },
  { id: 2, title: "Grocery list", body: "Milk and eggs" },
];

function searchNotes(query, { ignoreQuery = false } = {}) {
  if (ignoreQuery) return [...NOTES];
  const needle = query.toLowerCase();
  return NOTES.filter((note) => `${note.title} ${note.body}`.toLowerCase().includes(needle));
}

function verifyMatch({ ignoreQuery = false } = {}) {
  const results = searchNotes("quarterly", { ignoreQuery });
  assert.ok(results.some((note) => note.title === "Quarterly plan"));
  assert.ok(!results.some((note) => note.title === "Grocery list"));
  return JSON.stringify(results);
}

function verifyEmpty({ hideEmpty = false } = {}) {
  const results = searchNotes("volcano");
  const emptyState = results.length === 0 && !hideEmpty;
  assert.equal(emptyState, true);
  return JSON.stringify({ results, emptyState });
}

function verifyKeyboard({ insertSlash = false } = {}) {
  const state = insertSlash
    ? { dialogOpened: false, insertedSlash: true }
    : { dialogOpened: true, insertedSlash: false };
  assert.equal(state.dialogOpened, true);
  assert.equal(state.insertedSlash, false);
  return JSON.stringify(state);
}

function verifyCli({ emptyJson = false } = {}) {
  const results = emptyJson ? [] : searchNotes("quarterly");
  const stdout = JSON.stringify(results);
  const exitCode = 0;
  const parsed = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.ok(parsed.some((note) => note.title === "Quarterly plan"));
  return JSON.stringify({ stdout, exitCode });
}

const CLAIMS = [
  {
    id: "search-match",
    entrypoint: "toolbar",
    verify: () => verifyMatch(),
    broken: () => verifyMatch({ ignoreQuery: true }),
    negativeId: "ignore-query",
  },
  {
    id: "search-empty",
    entrypoint: "toolbar",
    verify: () => verifyEmpty(),
    broken: () => verifyEmpty({ hideEmpty: true }),
    negativeId: "hide-empty-state",
  },
  {
    id: "search-keyboard",
    entrypoint: "keyboard",
    verify: () => verifyKeyboard(),
    broken: () => verifyKeyboard({ insertSlash: true }),
    negativeId: "insert-slash",
  },
  {
    id: "search-cli",
    entrypoint: "cli",
    verify: () => verifyCli(),
    broken: () => verifyCli({ emptyJson: true }),
    negativeId: "empty-json",
  },
];

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function runClaim(output, claim, command) {
  let status = "passed";
  let exitCode = 0;
  let happyEvidence = "";
  try {
    happyEvidence = claim.verify();
  } catch (error) {
    status = "failed";
    exitCode = 1;
    happyEvidence = `${error.name}: ${error.message}`;
  }

  let caught = false;
  let negativeEvidence = "";
  try {
    claim.broken();
    negativeEvidence = "broken implementation unexpectedly passed";
  } catch (error) {
    caught = error.code === "ERR_ASSERTION";
    negativeEvidence = caught ? `${error.name}: ${error.message}` : `${error.name}: ${error.message}`;
  }
  if (!caught) status = "failed";

  const relativePath = `artifacts/${claim.id}.txt`;
  const artifact = [
    `claim: ${claim.id}`,
    `entrypoint: ${claim.entrypoint}`,
    `happy_path: ${happyEvidence}`,
    `negative_control: ${claim.negativeId}`,
    `caught: ${caught}`,
    `negative_evidence: ${negativeEvidence}`,
    "",
  ].join("\n");
  const artifactPath = join(output, relativePath);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, artifact);

  return {
    claim_id: claim.id,
    entrypoint: claim.entrypoint,
    command,
    exit_code: exitCode,
    status,
    artifacts: [{ path: relativePath, sha256: sha256(artifact), kind: "stdout" }],
    negative_control: { id: claim.negativeId, caught, failing_claim: claim.id },
    cleanup: { started_processes_remaining: 0, evidence_preserved: true },
  };
}

export async function runSearchVerification({ output }) {
  const target = resolve(output);
  await mkdir(target, { recursive: true });
  const command = `node ${process.argv[1]}`;
  const claims = [];
  for (const claim of CLAIMS) claims.push(await runClaim(target, claim, command));
  claims.sort((a, b) => a.claim_id.localeCompare(b.claim_id));

  const counts = { passed: 0, failed: 0, skipped: 0, unreachable: 0 };
  for (const claim of claims) counts[claim.status] += 1;
  const manifest = {
    schema_version: "1.0",
    run_id: process.env.GITHUB_RUN_ID ?? "search-fixture",
    commit: process.env.GITHUB_SHA ?? "fixture",
    environment: { os: process.platform, node: process.version, runtime: "node" },
    claims,
    coverage: {
      total: claims.length,
      verified: counts.passed,
      failed: counts.failed,
      skipped: counts.skipped,
      unreachable: counts.unreachable,
      uncovered: 0,
    },
  };
  const manifestPath = join(target, "evidence.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, manifestPath, ok: counts.failed === 0 };
}

async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--output");
  const output = index === -1 ? "evidence" : args[index + 1];
  const result = await runSearchVerification({ output });
  console.log(`search verification: ${result.manifest.coverage.verified}/${result.manifest.coverage.total} passed`);
  console.log(`manifest: ${result.manifestPath}`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
