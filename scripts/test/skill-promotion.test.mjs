import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promoteSkill } from "../promote-skill.mjs";
import { rollbackSkill } from "../rollback-skill.mjs";

function scorecard(ready = true) {
  return {
    schema_version: "1.0",
    promotion_ready: ready,
    blockers: ready ? [] : ["cost ratio exceeded"],
    baseline_total: 6,
    candidate_total: 6,
    baseline_cost: 1,
    candidate_cost: 1.2,
    cost_ratio: 1.2,
    baseline_pass_rate: 1,
    candidate_pass_rate: 1,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skill-promotion-"));
  const registry = join(root, "registry");
  const candidateRoot = join(root, "candidates");
  const candidate = join(candidateRoot, "search");
  await mkdir(candidate, { recursive: true });
  await writeFile(join(candidate, "SKILL.md"), "# Search\n");
  const scorecardPath = join(root, "scorecard.json");
  await writeFile(scorecardPath, JSON.stringify(scorecard()));
  return { root, registry, candidateRoot, candidate, scorecardPath };
}

test("promotes a ready candidate and keeps the previous release", async () => {
  const { root, registry, candidateRoot, candidate, scorecardPath } = await fixture();
  try {
    const first = await promoteSkill({ registry, candidateRoot, candidate, scorecardPath, skill: "search" });
    const active = JSON.parse(await readFile(join(registry, "active.json"), "utf8"));
    assert.equal(active.release_id, first.release_id);
    assert.match(await readFile(join(registry, "releases", first.release_id, "SKILL.md"), "utf8"), /Search/);

    await writeFile(join(candidate, "SKILL.md"), "# Search v2\n");
    const second = await promoteSkill({ registry, candidateRoot, candidate, scorecardPath, skill: "search" });
    assert.equal(second.previous_release_id, first.release_id);
    const active2 = JSON.parse(await readFile(join(registry, "active.json"), "utf8"));
    assert.equal(active2.release_id, second.release_id);
    assert.match(await readFile(join(registry, "releases", first.release_id, "SKILL.md"), "utf8"), /Search/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses a blocked scorecard without changing active", async () => {
  const { root, registry, candidateRoot, candidate, scorecardPath } = await fixture();
  try {
    const first = await promoteSkill({ registry, candidateRoot, candidate, scorecardPath, skill: "search" });
    await writeFile(scorecardPath, JSON.stringify(scorecard(false)));
    await assert.rejects(() => promoteSkill({ registry, candidateRoot, candidate, scorecardPath, skill: "search" }), /not ready/);
    const active = JSON.parse(await readFile(join(registry, "active.json"), "utf8"));
    assert.equal(active.release_id, first.release_id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rolls back to a retained release and appends audit", async () => {
  const { root, registry, candidateRoot, candidate, scorecardPath } = await fixture();
  try {
    const first = await promoteSkill({ registry, candidateRoot, candidate, scorecardPath, skill: "search" });
    await writeFile(join(candidate, "SKILL.md"), "# Search v2\n");
    const second = await promoteSkill({ registry, candidateRoot, candidate, scorecardPath, skill: "search" });
    const rollback = await rollbackSkill({ registry, skill: "search", to: first.release_id });
    assert.equal(rollback.previous_release_id, second.release_id);
    const active = JSON.parse(await readFile(join(registry, "active.json"), "utf8"));
    assert.equal(active.release_id, first.release_id);
    const audit = (await readFile(join(registry, "audit.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(audit.map((row) => row.action), ["promote", "promote", "rollback"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects candidate path traversal", async () => {
  const { root, registry, candidateRoot, scorecardPath } = await fixture();
  try {
    await assert.rejects(() => promoteSkill({ registry, candidateRoot, candidate: join(candidateRoot, "..", "escape"), scorecardPath, skill: "search" }), /escapes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires a valid approval for high-risk promotion", async () => {
  const { root, registry, candidateRoot, candidate, scorecardPath } = await fixture();
  try {
    await assert.rejects(() => promoteSkill({ registry, candidateRoot, candidate, scorecardPath, skill: "search", requireApproval: true }), /approval/);
    const approvalPath = join(root, "approval.json");
    await writeFile(approvalPath, JSON.stringify({ schema_version: "1.0", operation: "promote-skill", approved_by: "lead", ticket: "OPS-1", expires_at: "2099-01-01" }));
    const promoted = await promoteSkill({ registry, candidateRoot, candidate, scorecardPath, skill: "search", requireApproval: true, approvalPath, asOf: "2026-11-24" });
    assert.ok(promoted.release_id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires operation-specific approval for rollback", async () => {
  const { root, registry, candidateRoot, candidate, scorecardPath } = await fixture();
  try {
    const first = await promoteSkill({ registry, candidateRoot, candidate, scorecardPath, skill: "search" });
    await writeFile(join(candidate, "SKILL.md"), "# Search v2\n");
    await promoteSkill({ registry, candidateRoot, candidate, scorecardPath, skill: "search" });
    await assert.rejects(() => rollbackSkill({ registry, skill: "search", to: first.release_id, requireApproval: true }), /approval/);
    const approvalPath = join(root, "approval.json");
    await writeFile(approvalPath, JSON.stringify({ schema_version: "1.0", operation: "promote-skill", approved_by: "lead", ticket: "OPS-1", expires_at: "2099-01-01" }));
    await assert.rejects(() => rollbackSkill({ registry, skill: "search", to: first.release_id, requireApproval: true, approvalPath, asOf: "2026-11-24" }), /does not match/);
    await writeFile(approvalPath, JSON.stringify({ schema_version: "1.0", operation: "rollback-skill", approved_by: "lead", ticket: "OPS-2", expires_at: "2099-01-01" }));
    const rolledBack = await rollbackSkill({ registry, skill: "search", to: first.release_id, requireApproval: true, approvalPath, asOf: "2026-11-24" });
    assert.equal(rolledBack.release_id, first.release_id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
