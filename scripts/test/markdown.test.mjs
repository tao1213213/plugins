import test from "node:test";
import assert from "node:assert/strict";
import { insertAdapterLine, normalizeText } from "../lib/markdown.mjs";

test("normalizes CRLF text to LF", () => {
  assert.equal(normalizeText("# Title\r\n\r\nBody\r\n"), "# Title\n\nBody\n");
});

test("inserts adapter after LF heading", () => {
  assert.equal(
    insertAdapterLine("# Title\n\nBody\n", "ADAPTER"),
    "# Title\n\nADAPTER\n\nBody\n",
  );
});

test("inserts adapter after CRLF heading and emits LF", () => {
  assert.equal(
    insertAdapterLine("# Title\r\n\r\nBody\r\n", "ADAPTER"),
    "# Title\n\nADAPTER\n\nBody\n",
  );
});

test("leaves text without H1 unchanged except line endings", () => {
  assert.equal(insertAdapterLine("Body\r\n", "ADAPTER"), "Body\n");
});
