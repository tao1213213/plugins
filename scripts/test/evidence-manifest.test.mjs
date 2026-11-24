import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateEvidence } from "../validate-evidence.mjs";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function manifest(artifactHash) {
  return {
    schema_version: "1.0",
    run_id: "search-fixture",
    commit: "fixture",
    environment: { os: "test", node: "test", runtime: "node" },
    claims: [
      {
        claim_id: "search-match",
        entrypoint: "toolbar",
        command: "node run.mjs",
        exit_code: 0,
        status: "passed",
        artifacts: [{ path: "artifacts/search-match.txt", sha256: artifactHash, kind: "stdout" }],
        negative_control: { id: "ignore-query", caught: true, failing_claim: "search-match" },
        cleanup: { started_processes_remaining: 0, evidence_preserved: true },
      },
    ],
    coverage: { total: 1, verified: 1, failed: 0, skipped: 0, unreachable: 0, uncovered: 0 },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "evidence-manifest-"));
  const artifactPath = join(root, "artifacts/search-match.txt");
  await mkdir(dirname(artifactPath), { recursive: true });
  const artifact = "Quarterly plan\n";
  await writeFile(artifactPath, artifact);
  return { root, artifactPath, artifact, value: manifest(sha256(artifact)) };
}

async function save(root, value) {
  const path = join(root, "evidence.json");
  await writeFile(path, JSON.stringify(value, null, 2));
  return path;
}

test("accepts a complete manifest with matching artifact hash", async () => {
  const { root, value } = await fixture();
  try {
    const path = await save(root, value);
    const result = await validateEvidence({ root, manifestPath: path });
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.equal(result.checked, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects an artifact hash mismatch", async () => {
  const { root, artifactPath, value } = await fixture();
  try {
    await writeFile(artifactPath, "tampered\n");
    const path = await save(root, value);
    const result = await validateEvidence({ root, manifestPath: path });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("sha256")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects artifact path traversal", async () => {
  const { root, value } = await fixture();
  try {
    value.claims[0].artifacts[0].path = "../outside.txt";
    const path = await save(root, value);
    const result = await validateEvidence({ root, manifestPath: path });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("escapes")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a negative control that was not caught", async () => {
  const { root, value } = await fixture();
  try {
    value.claims[0].negative_control.caught = false;
    const path = await save(root, value);
    const result = await validateEvidence({ root, manifestPath: path });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("negative_control")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects cleanup residue", async () => {
  const { root, value } = await fixture();
  try {
    value.claims[0].cleanup.started_processes_remaining = 1;
    const path = await save(root, value);
    const result = await validateEvidence({ root, manifestPath: path });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("cleanup")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects coverage that counts skipped work as verified", async () => {
  const { root, value } = await fixture();
  try {
    value.claims[0].status = "skipped";
    const path = await save(root, value);
    const result = await validateEvidence({ root, manifestPath: path });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("coverage")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a missing artifact", async () => {
  const { root, artifactPath, value } = await fixture();
  try {
    await rm(artifactPath);
    const path = await save(root, value);
    const result = await validateEvidence({ root, manifestPath: path });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("artifact")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
