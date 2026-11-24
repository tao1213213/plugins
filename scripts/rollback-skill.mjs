#!/usr/bin/env node

import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appendAudit, readActive, releaseExists, writeActiveAtomic } from "./lib/skill-registry.mjs";
import { checkRiskApproval } from "./check-risk-approval.mjs";

export async function rollbackSkill({ registry, skill, to, dryRun = false, requireApproval = false, approvalPath, asOf = new Date().toISOString().slice(0, 10) }) {
  const targetRoot = resolve(registry);
  const active = await readActive(targetRoot);
  if (!active || active.skill !== skill) throw new Error(`no active release for ${skill}`);
  if (!await releaseExists(targetRoot, to)) throw new Error(`unknown release ${to}`);
  if (requireApproval && !dryRun) {
    if (!approvalPath) throw new Error("approval required for high-risk rollback");
    const approval = await checkRiskApproval({ root: targetRoot, operation: "rollback-skill", approvalPath, asOf });
    if (!approval.ok) throw new Error(`approval rejected: ${approval.errors.join(", ")}`);
  }
  const result = { release_id: to, previous_release_id: active.release_id, audit_path: join(targetRoot, "audit.jsonl"), dry_run: dryRun };
  if (dryRun) return result;
  const at = new Date().toISOString();
  await writeActiveAtomic(targetRoot, { ...active, release_id: to, rolled_back_at: at });
  await appendAudit(targetRoot, { action: "rollback", skill, release_id: to, previous_release_id: active.release_id, at });
  return result;
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
  const result = await rollbackSkill({
    registry: value("--registry"),
    skill: value("--skill"),
    to: value("--to"),
    dryRun: args.includes("--dry-run"),
    requireApproval: args.includes("--require-approval"),
    approvalPath: optional("--approval"),
    asOf: optional("--as-of"),
  });
  console.log(`${result.dry_run ? "would roll back" : "rolled back"} to ${result.release_id}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
