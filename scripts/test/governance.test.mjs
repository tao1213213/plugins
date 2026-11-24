import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkExceptions } from "../check-exceptions.mjs";
import { checkPerformanceBudget } from "../check-performance-budget.mjs";
import { checkRiskApproval } from "../check-risk-approval.mjs";
import { runRollbackDrill } from "../rollback-drill.mjs";

async function write(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

test("performance budget passes, fails, and respects inconclusive", async () => {
  const root = await mkdtemp(join(tmpdir(), "budget-"));
  try {
    const budgets = { schema_version: "1.0", budgets: [{ name: "code_files", max: 10 }, { name: "test_cases", min: 5 }] };
    const metrics = { schema_version: "1.0", status: "ok", metrics: { code_files: 8, test_cases: 6 } };
    await write(join(root, "budgets.json"), budgets);
    await write(join(root, "metrics.json"), metrics);
    assert.equal((await checkPerformanceBudget({ root, budgetsPath: "budgets.json", metricsPath: "metrics.json" })).ok, true);
    metrics.metrics.code_files = 11;
    await write(join(root, "metrics.json"), metrics);
    const failed = await checkPerformanceBudget({ root, budgetsPath: "budgets.json", metricsPath: "metrics.json" });
    assert.equal(failed.ok, false);
    assert.ok(failed.errors.some((error) => error.includes("code_files")));
    metrics.status = "inconclusive";
    await write(join(root, "metrics.json"), metrics);
    const inconclusive = await checkPerformanceBudget({ root, budgetsPath: "budgets.json", metricsPath: "metrics.json" });
    assert.equal(inconclusive.ok, false);
    assert.ok(inconclusive.errors.some((error) => error.includes("INCONCLUSIVE")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exceptions require approval and expire", async () => {
  const root = await mkdtemp(join(tmpdir(), "exceptions-"));
  try {
    const policy = { schema_version: "1.0", exceptions: [{ id: "legacy", rule: "old-api", owner: "team", reason: "migration", expires_at: "2099-01-01", approved_by: "lead" }] };
    await write(join(root, "exceptions.json"), policy);
    assert.equal((await checkExceptions({ root, policyPath: "exceptions.json", asOf: "2026-11-24" })).ok, true);
    policy.exceptions[0].expires_at = "2020-01-01";
    await write(join(root, "exceptions.json"), policy);
    const expired = await checkExceptions({ root, policyPath: "exceptions.json", asOf: "2026-11-24" });
    assert.equal(expired.ok, false);
    assert.ok(expired.errors.some((error) => error.includes("expired")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("risk approval is operation-specific and time-bound", async () => {
  const root = await mkdtemp(join(tmpdir(), "approval-"));
  try {
    const approval = { schema_version: "1.0", operation: "promote-skill", approved_by: "lead", ticket: "OPS-1", expires_at: "2099-01-01" };
    await write(join(root, "approval.json"), approval);
    assert.equal((await checkRiskApproval({ root, operation: "promote-skill", approvalPath: "approval.json", asOf: "2026-11-24" })).ok, true);
    const wrong = await checkRiskApproval({ root, operation: "rollback-skill", approvalPath: "approval.json", asOf: "2026-11-24" });
    assert.equal(wrong.ok, false);
    approval.expires_at = "2020-01-01";
    await write(join(root, "approval.json"), approval);
    const expired = await checkRiskApproval({ root, operation: "promote-skill", approvalPath: "approval.json", asOf: "2026-11-24" });
    assert.equal(expired.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rollback drill promotes twice and restores the first release", async () => {
  const root = await mkdtemp(join(tmpdir(), "drill-"));
  try {
    const result = await runRollbackDrill({ root });
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.deepEqual(result.audit_actions, ["promote", "promote", "rollback"]);
    assert.equal(result.active_release_id, result.first_release_id);
    await assert.rejects(() => stat(result.registry));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
