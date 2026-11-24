import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPathWithin, createIsolatedWorkspace } from "../lib/isolated-workspace.mjs";

test("allows paths inside root and rejects traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "path-boundary-"));
  try {
    assertPathWithin(root, join(root, "work", "file.ts"));
    assert.throws(() => assertPathWithin(root, join(root, "..", "escape.ts")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses a fresh HOME and drops secret-bearing env", async () => {
  const parent = await mkdtemp(join(tmpdir(), "isolated-parent-"));
  try {
    const sandbox = await createIsolatedWorkspace({ root: parent });
    const env = sandbox.env({
      PATH: "/usr/bin",
      HOME: "/real/home",
      AWS_SECRET_ACCESS_KEY: "secret",
      NPM_CONFIG_USERCONFIG: "/real/.npmrc",
      LANG: "en_US.UTF-8",
    });
    assert.equal(env.HOME, sandbox.home);
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.LANG, "en_US.UTF-8");
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(env.NPM_CONFIG_USERCONFIG, undefined);
    await sandbox.cleanup();
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("cleanup removes the sandbox", async () => {
  const parent = await mkdtemp(join(tmpdir(), "isolated-parent-"));
  try {
    const sandbox = await createIsolatedWorkspace({ root: parent });
    await sandbox.cleanup();
    await assert.rejects(() => stat(sandbox.root));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
