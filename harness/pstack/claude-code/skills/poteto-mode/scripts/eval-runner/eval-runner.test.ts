import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findBlindingLeaks } from "./blinding";
import { assertPathWithin, cleanupSandbox, copyDirectory, createSandbox } from "./isolation";
import { buildScorecard } from "./scorecard";
import { collectTranscript } from "./transcripts";

describe("blinding", () => {
  test("allows organic project names and rejects meta words", () => {
    expect(findBlindingLeaks({ paths: ["proj-alpha"], prompt: "Improve search", headings: [] })).toEqual([]);
    const leaks = findBlindingLeaks({ paths: ["eval-run"], prompt: "score the result", headings: ["盲测"] });
    expect(leaks.some((leak) => leak.includes("eval"))).toBe(true);
    expect(leaks.some((leak) => leak.includes("score"))).toBe(true);
    expect(leaks.some((leak) => leak.includes("盲测"))).toBe(true);
  });
});

describe("isolation", () => {
  test("creates a scratch HOME, copies only the variant, and cleans up", async () => {
    const parent = await mkdtemp(join(tmpdir(), "runner-parent-"));
    const source = join(parent, "source");
    await mkdir(source);
    await writeFile(join(source, "agent.mjs"), "console.log('ok')\n");
    try {
      const sandbox = await createSandbox({ parent, name: "proj-alpha" });
      await copyDirectory(source, sandbox.work);
      expect(await readFile(join(sandbox.work, "agent.mjs"), "utf8")).toContain("console.log");
      const env = sandbox.env({ PATH: "/usr/bin", HOME: "/real/home", AWS_SECRET_ACCESS_KEY: "secret" });
      expect(env.HOME).toBe(sandbox.home);
      expect(env.PATH).toBe("/usr/bin");
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(() => assertPathWithin(sandbox.root, join(sandbox.root, "..", "escape"))).toThrow();
      await cleanupSandbox(sandbox);
      await expect(stat(sandbox.root)).rejects.toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe("transcripts", () => {
  test("extracts tool calls and flags network or out-of-root reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "runner-transcript-"));
    try {
      const transcript = join(root, "agent.jsonl");
      const rows = [
        { type: "assistant", message: { model: "auto", content: [
          { type: "tool_use", name: "Read", input: { file_path: join(root, "work", "file.ts") } },
          { type: "tool_use", name: "WebFetch", input: { url: "https://example.com" } },
        ] } },
      ];
      await writeFile(transcript, rows.map((row) => JSON.stringify(row)).join("\n"));
      const result = await collectTranscript({ transcriptPath: transcript, allowedRoot: root });
      expect(result.tool_calls).toHaveLength(2);
      expect(result.violations.some((violation) => violation.includes("network"))).toBe(true);
      const outside = await collectTranscript({ transcriptPath: join(root, "..", "outside.jsonl"), allowedRoot: root });
      expect(outside.violations.some((violation) => violation.includes("escapes"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("scorecard", () => {
  const runs = [
    { variant: "base", exit_code: 0, duration_ms: 100, cost_usd: 1, retries: 0 },
    { variant: "new", exit_code: 0, duration_ms: 120, cost_usd: 1.2, retries: 0 },
  ];

  test("blocks promotion when cost or evidence gates fail", () => {
    const blocked = buildScorecard({ runs, judgeScores: { base: [2, 2, 2], new: [2, 2, 2] }, baseline: "base", candidate: "new", maxCostRatio: 1.1, blindingOk: true, chainOk: true, criticalRegressions: 0 });
    expect(blocked.promotion_ready).toBe(false);
    expect(blocked.blockers.some((blocker) => blocker.includes("cost"))).toBe(true);
    const leaked = buildScorecard({ runs, judgeScores: { base: [2, 2, 2], new: [2, 2, 2] }, baseline: "base", candidate: "new", maxCostRatio: 2, blindingOk: false, chainOk: true, criticalRegressions: 0 });
    expect(leaked.promotion_ready).toBe(false);
    expect(leaked.blockers.some((blocker) => blocker.includes("blinding"))).toBe(true);
  });

  test("allows promotion only when outcome, cost, and evidence pass", () => {
    const ready = buildScorecard({ runs, judgeScores: { base: [2, 2, 2], new: [2, 2, 2] }, baseline: "base", candidate: "new", maxCostRatio: 1.5, blindingOk: true, chainOk: true, criticalRegressions: 0 });
    expect(ready.promotion_ready).toBe(true);
    expect(ready.candidate_total).toBe(6);
  });
});
