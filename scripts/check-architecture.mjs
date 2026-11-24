#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { matchesGlob } from "./lib/glob.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = join(ROOT, "schemas/architecture-boundaries.schema.json");
const SKIP = new Set([".git", ".next", "build", "coverage", "dist", "node_modules", "target", "third_party", "vendor"]);
const CODE_FILE = /\.(?:cjs|js|jsx|mjs|py|ts|tsx)$/i;
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"];

async function walk(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, path));
    else if (entry.isFile() && CODE_FILE.test(entry.name)) files.push(path);
  }
  return files.sort();
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function imports(text, extension) {
  const found = [];
  if (extension === ".py") {
    for (const match of text.matchAll(/^\s*from\s+([.\w]+)\s+import\s+/gm)) {
      if (match[1].startsWith(".")) found.push(match[1]);
    }
    return found;
  }
  const patterns = [
    /\bimport\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

async function resolveRelative(root, source, specifier) {
  if (!specifier.startsWith(".")) return null;
  const raw = posix.normalize(posix.join(posix.dirname(source), specifier));
  const candidates = [raw, ...EXTENSIONS.map((extension) => `${raw}${extension}`), ...EXTENSIONS.map((extension) => posix.join(raw, `index${extension}`))];
  for (const candidate of candidates) {
    if (await exists(join(root, candidate))) return candidate;
  }
  return raw;
}

export async function checkArchitecture({ root, policyPath }) {
  const base = resolve(root);
  const policy = JSON.parse(await readFile(resolve(base, policyPath), "utf8"));
  const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  if (!validate(policy)) throw new Error(`invalid architecture policy: ${JSON.stringify(validate.errors)}`);
  const errors = [];
  const files = await walk(base);
  for (const path of files) {
    const source = path.slice(base.length + 1).replaceAll("\\", "/");
    if (!policy.ownership.some((rule) => matchesGlob(source, rule.path))) {
      errors.push(`${source}: no architecture owner`);
    }
    const text = await readFile(path, "utf8");
    for (const specifier of imports(text, path.slice(path.lastIndexOf(".")).toLowerCase())) {
      const target = await resolveRelative(base, source, specifier);
      if (!target) continue;
      for (const boundary of policy.boundaries) {
        if (matchesGlob(source, boundary.from) && boundary.forbid.some((pattern) => matchesGlob(target, pattern))) {
          errors.push(`${source}: ${boundary.name} forbids import ${specifier} -> ${target}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors, checked: files.length };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index === -1 ? fallback : args[index + 1];
  };
  const result = await checkArchitecture({ root: value("--root", process.cwd()), policyPath: value("--policy", "architecture-boundaries.json") });
  if (!result.ok) {
    for (const error of result.errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS architecture checked ${result.checked} code files`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
