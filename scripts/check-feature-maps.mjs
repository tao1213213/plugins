#!/usr/bin/env node

import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = join(ROOT, "schemas", "feature-map.schema.json");
const REQUIRED_HEADINGS = [
  "Sub-features",
  "How to get to it (user POV)",
  "Driving it with ",
  "Gotchas",
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function checkFeatureMaps({ root, dir }) {
  const base = resolve(root);
  const targetDir = resolve(base, dir);
  const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  const files = (await readdir(targetDir)).filter((name) => name.endsWith(".contract.json")).sort();
  const errors = [];

  for (const file of files) {
    const path = join(targetDir, file);
    let value;
    try {
      value = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      errors.push(`${file}: invalid JSON: ${error.message}`);
      continue;
    }

    if (!validate(value)) {
      for (const error of validate.errors ?? []) {
        errors.push(`${file}: ${error.instancePath || "/"} ${error.message}`);
      }
      continue;
    }

    const ids = new Set();
    for (const claim of value.claims) {
      if (ids.has(claim.id)) errors.push(`${file}: duplicate claim id ${claim.id}`);
      ids.add(claim.id);
      for (const control of claim.negative_controls) {
        if (control.must_fail !== claim.id) {
          errors.push(`${file}: claim ${claim.id} negative control ${control.id} must_fail ${control.must_fail}, expected ${claim.id}`);
        }
      }
    }

    const mapPath = join(targetDir, value.map_file);
    if (!await exists(mapPath)) {
      errors.push(`${file}: map file not found: ${value.map_file}`);
      continue;
    }
    const map = await readFile(mapPath, "utf8");
    for (const heading of REQUIRED_HEADINGS) {
      if (!map.includes(`## ${heading}`)) {
        errors.push(`${file}: map ${value.map_file} missing required heading ${heading.trim()}`);
      }
    }
    for (const claim of value.claims) {
      if (!map.includes(claim.id)) errors.push(`${file}: claim ${claim.id} not found in map ${value.map_file}`);
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
  const result = await checkFeatureMaps({
    root: value("--root", process.cwd()),
    dir: value("--dir", "pstack/skills/create-verification-skill/references/feature-map-example"),
  });
  if (!result.ok) {
    for (const error of result.errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS checked ${result.checked} feature-map contracts`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
