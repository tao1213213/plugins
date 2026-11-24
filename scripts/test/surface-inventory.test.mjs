import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { generateSurfaceInventory, renderSurfaceInventory } from "../generate-surface-inventory.mjs";

async function write(root, path, content) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

test("detects human and program client surfaces with source evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "surface-inventory-"));
  try {
    await write(root, "app/search/page.tsx", "export default function SearchPage() { return null; }\n");
    await write(root, "package.json", JSON.stringify({ name: "notes", bin: { notes: "cli.js" } }));
    await write(root, "src/mcp/server.ts", "const server = new McpServer();\n");
    await write(root, "src/sdk/index.ts", "export function searchNotes() {}\n");
    await write(root, "src/webhooks/stripe.ts", "export async function stripeWebhook() {}\n");
    await write(root, "src/device/enrollment.ts", "export async function enrollDevice() {}\n");

    const inventory = await generateSurfaceInventory({ root });
    const classes = inventory.surfaces.map((surface) => surface.client_class);

    assert.deepEqual(classes, [
      "device-agent",
      "human-cli",
      "human-web",
      "mcp",
      "sdk",
      "webhook",
    ]);
    assert.equal(inventory.surfaces.length, 6);
    for (const surface of inventory.surfaces) {
      assert.ok(surface.id);
      assert.ok(surface.entrypoints.length > 0);
      assert.ok(surface.entrypoints.every((entry) => entry.source.startsWith("src/") || entry.source.startsWith("app/") || entry.source === "package.json"));
      assert.equal(surface.coverage.status, "uncovered");
      assert.ok(surface.coverage.reason);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ignores dependency and VCS directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "surface-inventory-"));
  try {
    await write(root, "node_modules/pkg/app/secret/page.tsx", "export default function Page() {}\n");
    await write(root, ".git/hooks/webhook.ts", "export function webhook() {}\n");
    await write(root, "src/real/webhook.ts", "export function webhook() {}\n");
    await write(root, "src/real/webhook.test.ts", "export function webhook() {}\n");
    await write(root, "__tests__/webhook.ts", "export function webhook() {}\n");

    const inventory = await generateSurfaceInventory({ root });
    assert.equal(inventory.surfaces.length, 1);
    assert.equal(inventory.surfaces[0].client_class, "webhook");
    assert.equal(inventory.surfaces[0].entrypoints[0].source, "src/real/webhook.ts");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("output is deterministic across runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "surface-inventory-"));
  try {
    await write(root, "app/search/page.tsx", "export default function Page() {}\n");
    await write(root, "package.json", JSON.stringify({ name: "notes", bin: { notes: "cli.js" } }));

    const first = await generateSurfaceInventory({ root });
    const second = await generateSurfaceInventory({ root });

    assert.deepEqual(first, second);
    assert.equal(renderSurfaceInventory(first), renderSurfaceInventory(second));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated inventory and example satisfy the schema", async () => {
  const schema = JSON.parse(await readFile(new URL("../../schemas/surface-inventory.schema.json", import.meta.url), "utf8"));
  const example = JSON.parse(await readFile(new URL("../../examples/surface-inventory.json", import.meta.url), "utf8"));
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  assert.equal(validate(example), true, JSON.stringify(validate.errors));
  const root = await mkdtemp(join(tmpdir(), "surface-inventory-"));
  try {
    await write(root, "app/search/page.tsx", "export default function Page() {}\n");
    const generated = await generateSurfaceInventory({ root });
    assert.equal(validate(generated), true, JSON.stringify(validate.errors));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("module can be imported without CLI argv", () => {
  const moduleUrl = new URL("../generate-surface-inventory.mjs", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `import(${JSON.stringify(moduleUrl)}).then(() => console.log("ok"))`],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "ok");
});

test("CLI check fails when a new surface appears", async () => {
  const root = await mkdtemp(join(tmpdir(), "surface-inventory-cli-"));
  try {
    await write(root, "app/search/page.tsx", "export default function Page() {}\n");
    const output = join(root, "inventory.json");
    const script = fileURLToPath(new URL("../generate-surface-inventory.mjs", import.meta.url));
    const generated = spawnSync(process.execPath, [script, "--root", root, "--output", output], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);

    await write(root, "src/webhooks/search.ts", "export function searchWebhook() {}\n");
    const stale = spawnSync(process.execPath, [script, "--root", root, "--check", output], { encoding: "utf8" });
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /out of date/);

    const refreshed = spawnSync(process.execPath, [script, "--root", root, "--output", output], { encoding: "utf8" });
    assert.equal(refreshed.status, 0, refreshed.stderr);
    const clean = spawnSync(process.execPath, [script, "--root", root, "--check", output], { encoding: "utf8" });
    assert.equal(clean.status, 0, clean.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
