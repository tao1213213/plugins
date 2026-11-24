import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSearchVerification } from "../../examples/search-verification/run.mjs";
import { checkVerificationEvidence } from "../check-verification-evidence.mjs";

function inventory() {
  return {
    schema_version: "1.0",
    summary: {
      total_surfaces: 2,
      by_client_class: { "device-agent": 0, "human-cli": 1, "human-web": 1, mcp: 0, sdk: 0, webhook: 0 },
    },
    surfaces: [
      {
        id: "human-web:app/search/page.tsx",
        client_class: "human-web",
        entrypoints: [{ kind: "route", value: "/search", source: "app/search/page.tsx" }],
        owner: "search",
        coverage: { status: "verified", reason: "Browser claims have evidence" },
        claim_ids: ["search-match", "search-empty", "search-keyboard"],
      },
      {
        id: "human-cli:package.json",
        client_class: "human-cli",
        entrypoints: [{ kind: "command", value: "notes -> cli.js", source: "package.json" }],
        owner: "search",
        coverage: { status: "verified", reason: "CLI claim has evidence" },
        claim_ids: ["search-cli"],
      },
    ],
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "verification-gate-"));
  const run = await runSearchVerification({ output: root });
  const inventoryPath = join(root, "surface-inventory.json");
  await writeFile(inventoryPath, JSON.stringify(inventory(), null, 2));
  return { root, manifestPath: run.manifestPath, inventoryPath };
}

test("accepts a closed inventory and evidence set", async () => {
  const { root, manifestPath, inventoryPath } = await fixture();
  try {
    const result = await checkVerificationEvidence({ root, manifestPath, inventoryPath });
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.equal(result.checked, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails when inventory references a claim without evidence", async () => {
  const { root, manifestPath, inventoryPath } = await fixture();
  try {
    const value = JSON.parse(await readFile(manifestPath, "utf8"));
    value.claims = value.claims.filter((claim) => claim.claim_id !== "search-cli");
    value.coverage = { total: 3, verified: 3, failed: 0, skipped: 0, unreachable: 0, uncovered: 0 };
    await writeFile(manifestPath, JSON.stringify(value, null, 2));
    const result = await checkVerificationEvidence({ root, manifestPath, inventoryPath });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("missing evidence claim")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails when a surface is uncovered without a waiver", async () => {
  const { root, manifestPath, inventoryPath } = await fixture();
  try {
    const value = inventory();
    value.surfaces[1].coverage = { status: "uncovered", reason: "No recipe yet" };
    value.surfaces[1].claim_ids = [];
    await writeFile(inventoryPath, JSON.stringify(value, null, 2));
    const result = await checkVerificationEvidence({ root, manifestPath, inventoryPath });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("waiver")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails when a waiver is expired", async () => {
  const { root, manifestPath, inventoryPath } = await fixture();
  try {
    const value = inventory();
    value.surfaces[1].coverage = { status: "uncovered", reason: "No recipe yet" };
    value.surfaces[1].claim_ids = [];
    value.surfaces[1].waiver = { owner: "search", reason: "Deferred", expires_at: "2000-01-01" };
    await writeFile(inventoryPath, JSON.stringify(value, null, 2));
    const result = await checkVerificationEvidence({ root, manifestPath, inventoryPath });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("waiver expired")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails on cleanup residue", async () => {
  const { root, manifestPath, inventoryPath } = await fixture();
  try {
    const value = JSON.parse(await readFile(manifestPath, "utf8"));
    value.claims[0].cleanup.started_processes_remaining = 1;
    await writeFile(manifestPath, JSON.stringify(value, null, 2));
    const result = await checkVerificationEvidence({ root, manifestPath, inventoryPath });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("cleanup")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns a failure when the manifest is missing", async () => {
  const { root, inventoryPath } = await fixture();
  try {
    const result = await checkVerificationEvidence({ root, manifestPath: join(root, "missing.json"), inventoryPath });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("manifest")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
