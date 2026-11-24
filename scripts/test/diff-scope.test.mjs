import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkDiffScope } from "../check-diff-scope.mjs";

const POLICY = {
  schema_version: "1.0",
  allowed: ["app/search/**"],
  forbidden: ["app/search/secrets/**", "electron-main/**"],
};

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function commit(root, message) {
  git(root, ["add", "-A"]);
  git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

async function write(root, path, content = "content\n") {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "diff-scope-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "core.autocrlf", "false"]);
  await write(root, "policy.json", JSON.stringify(POLICY));
  await write(root, "app/search/page.tsx");
  await write(root, "outside.txt");
  const base = commit(root, "base");
  return { root, base };
}

test("accepts changes inside the allowed scope", async () => {
  const { root, base } = await fixture();
  try {
    await write(root, "app/search/result.tsx", "changed\n");
    const head = commit(root, "allowed change");
    const result = await checkDiffScope({ root, base, head, policyPath: "policy.json" });
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.equal(result.checked, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects changes outside the allowed scope", async () => {
  const { root, base } = await fixture();
  try {
    await write(root, "app/billing/page.tsx", "changed\n");
    const head = commit(root, "outside change");
    const result = await checkDiffScope({ root, base, head, policyPath: "policy.json" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("outside allowed scope")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects forbidden paths even when they are allowed", async () => {
  const { root, base } = await fixture();
  try {
    await write(root, "app/search/secrets/token.ts", "secret\n");
    const head = commit(root, "forbidden change");
    const result = await checkDiffScope({ root, base, head, policyPath: "policy.json" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("forbidden")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not let a glob prefix match a sibling directory", async () => {
  const { root, base } = await fixture();
  try {
    await write(root, "app/search-other/page.tsx", "changed\n");
    const head = commit(root, "sibling change");
    const result = await checkDiffScope({ root, base, head, policyPath: "policy.json" });
    assert.equal(result.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects deletions outside the allowed scope", async () => {
  const { root, base } = await fixture();
  try {
    await unlink(join(root, "outside.txt"));
    const head = commit(root, "outside deletion");
    const result = await checkDiffScope({ root, base, head, policyPath: "policy.json" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("outside.txt")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("accepts an empty diff", async () => {
  const { root, base } = await fixture();
  try {
    const result = await checkDiffScope({ root, base, head: base, policyPath: "policy.json" });
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.equal(result.checked, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
