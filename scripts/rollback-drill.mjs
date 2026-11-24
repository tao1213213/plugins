#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promoteSkill } from "./promote-skill.mjs";
import { rollbackSkill } from "./rollback-skill.mjs";

export async function runRollbackDrill({ root }) {
  const work = await mkdtemp(join(resolve(root), "rollback-drill-"));
  const registry = join(work, "registry");
  const candidateRoot = join(work, "candidates");
  const candidate = join(candidateRoot, "search");
  const scorecardPath = join(work, "scorecard.json");
  try {
    await mkdir(candidate, { recursive: true });
    await writeFile(join(candidate, "SKILL.md"), "# Search v1\n");
    await writeFile(scorecardPath, JSON.stringify({ schema_version: "1.0", promotion_ready: true, blockers: [], baseline_total: 6, candidate_total: 6, baseline_cost: 1, candidate_cost: 1, cost_ratio: 1, baseline_pass_rate: 1, candidate_pass_rate: 1 }));
    const first = await promoteSkill({ registry, candidateRoot, candidate, scorecardPath, skill: "search" });
    await writeFile(join(candidate, "SKILL.md"), "# Search v2\n");
    const second = await promoteSkill({ registry, candidateRoot, candidate, scorecardPath, skill: "search" });
    await rollbackSkill({ registry, skill: "search", to: first.release_id });
    const active = JSON.parse(await readFile(join(registry, "active.json"), "utf8"));
    const audit = (await readFile(join(registry, "audit.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    return {
      ok: active.release_id === first.release_id,
      errors: active.release_id === first.release_id ? [] : ["active release did not roll back"],
      first_release_id: first.release_id,
      second_release_id: second.release_id,
      active_release_id: active.release_id,
      audit_actions: audit.map((row) => row.action),
      registry,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--root");
  const root = index === -1 ? process.cwd() : args[index + 1];
  const result = await runRollbackDrill({ root });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
