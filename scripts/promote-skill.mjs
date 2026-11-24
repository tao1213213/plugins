#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertPathWithin } from "./lib/isolated-workspace.mjs";
import { appendAudit, copyDirectory, hashDirectory, readActive, validateScorecard, writeActiveAtomic } from "./lib/skill-registry.mjs";
import { checkRiskApproval } from "./check-risk-approval.mjs";

export async function promoteSkill({ registry, candidateRoot, candidate, scorecardPath, skill, requireApproval = false, approvalPath, asOf = new Date().toISOString().slice(0, 10) }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) throw new Error("invalid skill name");
  const base = resolve(candidateRoot);
  const source = resolve(candidate);
  assertPathWithin(base, source);
  const targetRoot = resolve(registry);
  if (requireApproval) {
    if (!approvalPath) throw new Error("approval required for high-risk promotion");
    const approval = await checkRiskApproval({ root: targetRoot, operation: "promote-skill", approvalPath, asOf });
    if (!approval.ok) throw new Error(`approval rejected: ${approval.errors.join(", ")}`);
  }
  const scorecard = await validateScorecard(resolve(scorecardPath));
  if (!scorecard.promotion_ready) throw new Error(`scorecard is not ready: ${scorecard.blockers.join(", ")}`);

  const releaseId = (await hashDirectory(source)).slice(0, 20);
  const releasePath = join(targetRoot, "releases", releaseId);
  await mkdir(join(targetRoot, "releases"), { recursive: true });
  try {
    await stat(releasePath);
  } catch {
    const staging = join(targetRoot, "releases", `.staging-${releaseId}-${process.pid}`);
    await copyDirectory(source, staging);
    await rename(staging, releasePath);
  }

  const previous = await readActive(targetRoot);
  const previousReleaseId = previous?.skill === skill ? previous.release_id : null;
  const scorecardHash = createHash("sha256").update(await readFile(resolve(scorecardPath))).digest("hex");
  const active = {
    schema_version: "1.0",
    skill,
    release_id: releaseId,
    promoted_at: new Date().toISOString(),
    scorecard_sha256: scorecardHash,
  };
  await writeActiveAtomic(targetRoot, active);
  await appendAudit(targetRoot, { action: "promote", skill, release_id: releaseId, previous_release_id: previousReleaseId, at: active.promoted_at });
  return { release_id: releaseId, previous_release_id: previousReleaseId, audit_path: join(targetRoot, "audit.jsonl") };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    if (index === -1 || !args[index + 1]) throw new Error(`missing ${flag}`);
    return args[index + 1];
  };
  const optional = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const result = await promoteSkill({
    registry: value("--registry"),
    candidateRoot: value("--candidate-root"),
    candidate: value("--candidate"),
    scorecardPath: value("--scorecard"),
    skill: value("--skill"),
    requireApproval: args.includes("--require-approval"),
    approvalPath: optional("--approval"),
    asOf: optional("--as-of"),
  });
  console.log(`promoted ${result.release_id}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
