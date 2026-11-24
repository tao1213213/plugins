import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { findBlindingLeaks } from "./blinding";
import { prepareEvalPlan } from "./plan";
import { runEvalPlan } from "./runner";
import { buildScorecard } from "./scorecard";
import { parseCommand, parseEvalPlan, parseRubric, parseRuns, parseScores, parseVariants } from "./types";

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${name}`);
  }
  const value = process.argv[index + 1];
  if (!value) throw new Error(`missing value for ${name}`);
  return value;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "prepare") {
    const plan = await prepareEvalPlan({
      root: arg("--root"),
      prompt: await readFile(resolve(arg("--prompt")), "utf8"),
      variants: parseVariants(await readJson(arg("--variants"))),
      rubric: parseRubric(await readJson(arg("--rubric"))),
      command: parseCommand(JSON.parse(arg("--command"))),
    });
    const output = resolve(arg("--output", "plan.json"));
    await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(`prepared ${plan.variants.length} sandboxes: ${output}`);
    return;
  }
  if (command === "run") {
    const plan = parseEvalPlan(await readJson(arg("--plan")));
    const runs = await runEvalPlan(plan);
    const output = resolve(arg("--output", "runs.json"));
    await writeFile(output, `${JSON.stringify(runs, null, 2)}\n`);
    console.log(`ran ${runs.length} variants: ${output}`);
    return;
  }
  if (command === "check") {
    const plan = parseEvalPlan(await readJson(arg("--plan")));
    const runs = parseRuns(await readJson(arg("--runs")));
    const scores = parseScores(await readJson(arg("--scores")));
    const blindingOk = findBlindingLeaks({
      paths: plan.variants.flatMap((variant) => [variant.name, variant.sandbox]),
      prompt: plan.prompt,
      headings: [],
    }).length === 0;
    const chainOk = runs.every((run) => run.chain_ok);
    const scorecard = buildScorecard({
      runs,
      judgeScores: scores,
      baseline: arg("--baseline"),
      candidate: arg("--candidate"),
      maxCostRatio: Number(arg("--max-cost-ratio", "1.5")),
      blindingOk,
      chainOk,
      criticalRegressions: Number(arg("--critical-regressions", "0")),
    });
    const output = resolve(arg("--output", "scorecard.json"));
    await writeFile(output, `${JSON.stringify(scorecard, null, 2)}\n`);
    console.log(`promotion_ready=${scorecard.promotion_ready}: ${output}`);
    if (!scorecard.promotion_ready) process.exitCode = 1;
    return;
  }
  throw new Error("usage: eval-runner prepare|run|check");
}

await main();
