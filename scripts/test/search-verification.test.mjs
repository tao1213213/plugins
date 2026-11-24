import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvidence } from "../validate-evidence.mjs";

test("search harness emits four passing claims and valid evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "search-verification-"));
  try {
    const script = fileURLToPath(new URL("../../examples/search-verification/run.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script, "--output", root], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);

    const manifestPath = join(root, "evidence.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.claims.length, 4);
    assert.deepEqual(manifest.claims.map((claim) => claim.claim_id), [
      "search-cli",
      "search-empty",
      "search-keyboard",
      "search-match",
    ]);
    assert.ok(manifest.claims.every((claim) => claim.status === "passed"));
    assert.ok(manifest.claims.every((claim) => claim.negative_control.caught));
    assert.equal(manifest.coverage.verified, 4);

    const validated = await validateEvidence({ root, manifestPath });
    assert.equal(validated.ok, true, validated.errors.join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
