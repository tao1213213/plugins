import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { assertPathWithin } from "./isolated-workspace.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_PATH = join(ROOT, "schemas/eval-scorecard.schema.json");
const SKIP = new Set([".git", "node_modules"]);

async function walk(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, path));
    else files.push(path);
  }
  return files.sort();
}

export async function hashDirectory(root) {
  const hash = createHash("sha256");
  for (const path of await walk(root)) {
    hash.update(path.slice(root.length).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function copyDirectory(source, target) {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else {
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, await readFile(from));
    }
  }
}

export async function validateScorecard(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  if (!validate(value)) throw new Error(`invalid scorecard: ${JSON.stringify(validate.errors)}`);
  return value;
}

export async function readActive(registry) {
  try {
    return JSON.parse(await readFile(join(registry, "active.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeActiveAtomic(registry, value) {
  await mkdir(registry, { recursive: true });
  const target = join(registry, "active.json");
  const temp = `${target}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  try {
    await rename(temp, target);
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EEXIST") throw error;
    await rm(target, { force: true });
    await rename(temp, target);
  }
}

export async function appendAudit(registry, value) {
  await mkdir(registry, { recursive: true });
  await appendFile(join(registry, "audit.jsonl"), `${JSON.stringify(value)}\n`);
}

export async function releaseExists(registry, releaseId) {
  try {
    return (await stat(join(registry, "releases", releaseId))).isDirectory();
  } catch {
    return false;
  }
}
