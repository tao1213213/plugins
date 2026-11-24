import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFeatureMaps } from "../check-feature-maps.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXAMPLE_DIR = "pstack/skills/create-verification-skill/references/feature-map-example";

function contract() {
  return {
    schema_version: "1.0",
    id: "search",
    surface: "human-web",
    map_file: "search.md",
    claims: [
      {
        id: "search-match",
        observable: "Matching note appears and non-matching note is absent",
        entrypoints: ["toolbar"],
        happy_path: ["Open search", "Type quarterly"],
        negative_controls: [{ id: "ignore-query", break: "Return all notes", must_fail: "search-match" }],
        artifacts: ["aria", "screenshot"],
      },
      {
        id: "search-empty",
        observable: "Explicit empty state appears",
        entrypoints: ["toolbar"],
        happy_path: ["Open search", "Type volcano"],
        negative_controls: [{ id: "hide-empty", break: "Render no status", must_fail: "search-empty" }],
        artifacts: ["aria"],
      },
      {
        id: "search-cli",
        observable: "CLI JSON matches UI results",
        entrypoints: ["cli"],
        happy_path: ["Run notes search quarterly"],
        negative_controls: [{ id: "wrong-json", break: "Return an empty array", must_fail: "search-cli" }],
        artifacts: ["stdout", "exit_code"],
      },
    ],
    cleanup: ["Close browser", "Remove disposable data"],
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "feature-map-"));
  const dir = join(root, "maps");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "search.md"), `# Search\n\n## Sub-features\n- search-match\n- search-empty\n- search-cli\n\n## How to get to it (user POV)\n\n## Driving it with harness\n\n## Gotchas\n`);
  return { root, dir };
}

test("accepts the shipped search contract", async () => {
  const result = await checkFeatureMaps({ root: ROOT, dir: EXAMPLE_DIR });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.checked, 1);
});

test("rejects duplicate claim IDs", async () => {
  const { root, dir } = await fixture();
  try {
    const value = contract();
    value.claims[1].id = value.claims[0].id;
    await writeFile(join(dir, "search.contract.json"), JSON.stringify(value));
    const result = await checkFeatureMaps({ root, dir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("duplicate claim id")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a negative control that targets another claim", async () => {
  const { root, dir } = await fixture();
  try {
    const value = contract();
    value.claims[0].negative_controls[0].must_fail = "search-empty";
    await writeFile(join(dir, "search.contract.json"), JSON.stringify(value));
    const result = await checkFeatureMaps({ root, dir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("must_fail")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a missing Markdown map", async () => {
  const { root, dir } = await fixture();
  try {
    await rm(join(dir, "search.md"));
    await writeFile(join(dir, "search.contract.json"), JSON.stringify(contract()));
    const result = await checkFeatureMaps({ root, dir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("map file")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects claims missing from the Markdown map", async () => {
  const { root, dir } = await fixture();
  try {
    await writeFile(join(dir, "search.md"), "# Search\n\n## Sub-features\n- search-match\n\n## How to get to it (user POV)\n\n## Driving it with harness\n\n## Gotchas\n");
    await writeFile(join(dir, "search.contract.json"), JSON.stringify(contract()));
    const result = await checkFeatureMaps({ root, dir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("not found in map")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires three to five claims", async () => {
  const { root, dir } = await fixture();
  try {
    const value = contract();
    value.claims = value.claims.slice(0, 2);
    await writeFile(join(dir, "search.contract.json"), JSON.stringify(value));
    const result = await checkFeatureMaps({ root, dir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("claims")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
