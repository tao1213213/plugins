import test from "node:test";
import assert from "node:assert/strict";
import { isTextPath, toPosixPath } from "../lib/path.mjs";

test("normalizes Windows separators", () => {
  assert.equal(toPosixPath("skills\\architect\\SKILL.md"), "skills/architect/SKILL.md");
});

test("leaves POSIX separators unchanged", () => {
  assert.equal(toPosixPath("skills/architect/SKILL.md"), "skills/architect/SKILL.md");
});

test("identifies text files without claiming binary assets", () => {
  assert.equal(isTextPath("skills/architect/SKILL.md"), true);
  assert.equal(isTextPath("LICENSE"), true);
  assert.equal(isTextPath("scripts/watch-pr/watch-pr"), true);
  assert.equal(isTextPath("scripts/bun.lock"), true);
  assert.equal(isTextPath("corpus/Counter/Counter.tla"), true);
  assert.equal(isTextPath("references/decision-log-template.tsv"), true);
  assert.equal(isTextPath("assets/diagram.png"), false);
});
