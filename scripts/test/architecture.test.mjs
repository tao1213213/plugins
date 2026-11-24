import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkArchitecture } from "../check-architecture.mjs";

const POLICY = {
  schema_version: "1.0",
  boundaries: [
    { name: "renderer-main", from: "electron-renderer/**", forbid: ["electron-main/**"], reason: "Renderer must not import main-process code" },
  ],
  ownership: [
    { path: "electron-renderer/**", owner: "ui" },
    { path: "electron-main/**", owner: "main" },
  ],
};

async function write(root, path, content) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "architecture-"));
  await write(root, "policy.json", JSON.stringify(POLICY));
  await write(root, "electron-main/node.ts", "export const main = true;\n");
  await write(root, "electron-renderer/view.ts", "export const view = true;\n");
  return root;
}

test("rejects a cross-layer relative import", async () => {
  const root = await fixture();
  try {
    await write(root, "electron-renderer/app.ts", "import { main } from '../electron-main/node';\n");
    const result = await checkArchitecture({ root, policyPath: "policy.json" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("renderer-main")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("allows an import inside the same layer", async () => {
  const root = await fixture();
  try {
    await write(root, "electron-renderer/app.ts", "import { view } from './view';\n");
    const result = await checkArchitecture({ root, policyPath: "policy.json" });
    assert.equal(result.ok, true, result.errors.join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ignores package imports", async () => {
  const root = await fixture();
  try {
    await write(root, "electron-renderer/app.ts", "import React from 'react';\n");
    const result = await checkArchitecture({ root, policyPath: "policy.json" });
    assert.equal(result.ok, true, result.errors.join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires an owner for every code file", async () => {
  const root = await fixture();
  try {
    await write(root, "unowned/file.ts", "export const x = 1;\n");
    const result = await checkArchitecture({ root, policyPath: "policy.json" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("owner")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checks dynamic imports", async () => {
  const root = await fixture();
  try {
    await write(root, "electron-renderer/app.ts", "export const load = () => import('../electron-main/node');\n");
    const result = await checkArchitecture({ root, policyPath: "policy.json" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("renderer-main")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
