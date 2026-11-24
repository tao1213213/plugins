import test from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatterName } from "../lib/frontmatter.mjs";

test("parses LF frontmatter", () => {
  assert.equal(parseFrontmatterName("---\nname: architect\n---\n# Architect\n"), "architect");
});

test("parses CRLF frontmatter", () => {
  assert.equal(parseFrontmatterName("---\r\nname: architect\r\n---\r\n# Architect\r\n"), "architect");
});

test("parses quoted names", () => {
  assert.equal(parseFrontmatterName('---\nname: "create-verification-skill"\n---\n'), "create-verification-skill");
});

test("returns empty string when name is missing", () => {
  assert.equal(parseFrontmatterName("---\ndescription: no name\n---\n"), "");
});
