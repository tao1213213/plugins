#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isTextPath, toPosixPath } from "./lib/path.mjs";

const CLIENT_CLASSES = [
  "device-agent",
  "human-cli",
  "human-web",
  "mcp",
  "sdk",
  "webhook",
];
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".venv",
  "build",
  "coverage",
  "dist",
  "harness",
  "node_modules",
  "target",
  "test",
  "tests",
  "__tests__",
  "vendor",
]);
const CODE_FILE = /\.(?:cjs|cs|go|java|js|jsx|kt|mjs|php|py|rb|rs|swift|ts|tsx)$/i;

async function walkFiles(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, path));
    else if (entry.isFile() && isTextPath(path) && !/\.(?:test|spec)\.[^.]+$/i.test(entry.name)) files.push(toPosixPath(relative(root, path)));
  }
  return files.sort();
}

function routeFromPath(path) {
  const appPage = path.match(/(?:^|\/)app\/(.+?)\/page\.(?:tsx?|jsx?)$/);
  if (appPage) return `/${appPage[1]}`;
  const page = path.match(/(?:^|\/)pages\/(.+?)\.(?:tsx?|jsx?)$/);
  if (page) return page[1] === "index" ? "/" : `/${page[1]}`;
  const route = path.match(/(?:^|\/)routes\/(.+?)\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java)$/);
  return route ? `/${route[1]}` : undefined;
}

function addSurface(map, clientClass, source, kind, value) {
  const id = `${clientClass}:${source}`;
  const surface = map.get(id) ?? {
    id,
    client_class: clientClass,
    entrypoints: [],
    owner: "unassigned",
    coverage: { status: "uncovered", reason: "No verification recipe linked" },
  };
  const entry = { kind, value, source };
  const key = JSON.stringify(entry);
  if (!surface.entrypoints.some((item) => JSON.stringify(item) === key)) {
    surface.entrypoints.push(entry);
  }
  map.set(id, surface);
}

async function readPackage(root) {
  try {
    return JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function generateSurfaceInventory({ root }) {
  const base = resolve(root);
  const files = await walkFiles(base);
  const pkg = await readPackage(base);
  const surfaces = new Map();

  if (pkg?.bin) {
    const bins = typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : pkg.bin;
    for (const [name, target] of Object.entries(bins)) {
      addSurface(surfaces, "human-cli", "package.json", "command", `${name} -> ${target}`);
    }
  }

  if (pkg?.exports) {
    const exports = typeof pkg.exports === "string" ? { ".": pkg.exports } : pkg.exports;
    for (const name of Object.keys(exports)) {
      addSurface(surfaces, "sdk", "package.json", "export", name);
    }
  }

  for (const path of files) {
    if (path === "package.json" || path === toPosixPath(relative(base, fileURLToPath(import.meta.url))) || !CODE_FILE.test(path)) continue;
    const text = await readFile(join(base, path), "utf8");
    const route = routeFromPath(path);
    if (route) addSurface(surfaces, "human-web", path, "route", route);

    if (/@Controller\(|(?:router|app|fastify)\.(?:get|post|put|patch|delete)\(/i.test(text)) {
      addSurface(surfaces, "human-web", path, "http-handler", path);
    }
    if (/new\s+McpServer|registerTool\s*\(|\.tool\s*\(/i.test(text)) {
      addSurface(surfaces, "mcp", path, "protocol-mount", "mcp");
    }
    if (/(?:^|\/)sdk\//i.test(path)) {
      addSurface(surfaces, "sdk", path, "export", "sdk");
    }
    if (/webhook/i.test(path) || /webhook/i.test(text)) {
      addSurface(surfaces, "webhook", path, "webhook", path);
    }
    if (/device[-_]?agent|enrollment|\bmdm\b/i.test(path) || /enrollDevice|deviceAgent|\bMDM\b/i.test(text)) {
      addSurface(surfaces, "device-agent", path, "device", path);
    }
  }

  const list = [...surfaces.values()]
    .map((surface) => ({
      ...surface,
      entrypoints: surface.entrypoints.sort((a, b) =>
        `${a.kind}\0${a.value}\0${a.source}`.localeCompare(`${b.kind}\0${b.value}\0${b.source}`)
      ),
    }))
    .sort((a, b) => a.client_class.localeCompare(b.client_class) || a.id.localeCompare(b.id));

  const summary = { total_surfaces: list.length, by_client_class: {} };
  for (const clientClass of CLIENT_CLASSES) {
    summary.by_client_class[clientClass] = list.filter((surface) => surface.client_class === clientClass).length;
  }

  return { schema_version: "1.0", summary, surfaces: list };
}

export function renderSurfaceInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index === -1 ? fallback : args[index + 1];
  };
  const root = value("--root", process.cwd());
  const output = value("--output");
  const check = value("--check");
  const rendered = renderSurfaceInventory(await generateSurfaceInventory({ root }));

  if (check) {
    const existing = await readFile(check, "utf8");
    if (existing !== rendered) {
      console.error(`Surface inventory is out of date: ${check}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Surface inventory is up to date: ${check}`);
    return;
  }

  if (output) await writeFile(output, rendered);
  else process.stdout.write(rendered);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
