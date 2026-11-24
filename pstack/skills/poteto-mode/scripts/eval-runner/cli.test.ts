import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));

function run(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

describe("eval runner CLI", () => {
  test("prepares sandboxes, runs commands, and emits a scorecard", async () => {
    const root = await mkdtemp(join(tmpdir(), "runner-cli-"));
    try {
      const base = join(root, "base-source");
      const fresh = join(root, "fresh-source");
      await mkdir(base);
      await mkdir(fresh);
      const agent = `import { writeFileSync } from "node:fs";\nwriteFileSync(".eval-usage.json", JSON.stringify({input_tokens: 10, output_tokens: 5, cost_usd: 1, retries: 0}));\nconsole.log("ok");\n`;
      await writeFile(join(base, "agent.mjs"), agent);
      await writeFile(join(fresh, "agent.mjs"), agent);
      await writeFile(join(root, "prompt.txt"), "Improve search results");
      await writeFile(join(root, "variants.json"), JSON.stringify([{ name: "proj-alpha", source: base }, { name: "proj-beta", source: fresh }]));
      await writeFile(join(root, "rubric.json"), JSON.stringify([{ id: "outcome", description: "Task completes" }, { id: "evidence", description: "Evidence exists" }, { id: "cost", description: "Cost is bounded" }]));
      const planPath = join(root, "plan.json");
      const runsPath = join(root, "runs.json");
      const scoresPath = join(root, "scores.json");
      const scorecardPath = join(root, "scorecard.json");
      await writeFile(scoresPath, JSON.stringify({ "proj-alpha": [2, 2, 2], "proj-beta": [2, 2, 2] }));

      const prepared = run(["prepare", "--root", join(root, "sandboxes"), "--prompt", join(root, "prompt.txt"), "--variants", join(root, "variants.json"), "--rubric", join(root, "rubric.json"), "--command", JSON.stringify(["node", "agent.mjs"]), "--output", planPath]);
      expect(prepared.status).toBe(0);
      const plan = JSON.parse(await readFile(planPath, "utf8"));
      expect(plan.variants).toHaveLength(2);

      const ran = run(["run", "--plan", planPath, "--output", runsPath]);
      expect(ran.status).toBe(0);
      const runs = JSON.parse(await readFile(runsPath, "utf8"));
      expect(runs).toHaveLength(2);
      expect(runs.every((item: { exit_code: number }) => item.exit_code === 0)).toBe(true);

      const checked = run(["check", "--plan", planPath, "--runs", runsPath, "--scores", scoresPath, "--baseline", "proj-alpha", "--candidate", "proj-beta", "--max-cost-ratio", "2", "--output", scorecardPath]);
      expect(checked.status).toBe(0);
      const scorecard = JSON.parse(await readFile(scorecardPath, "utf8"));
      expect(scorecard.promotion_ready).toBe(true);
      expect(scorecard.schema_version).toBe("1.0");
      expect(scorecard.candidate_total).toBe(6);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
