import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertPathWithin } from "./isolation";
import { collectTranscript } from "./transcripts";
import type { EvalPlan, RunResult, Usage } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readUsage(path: string): Promise<Usage> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(value)) return { input_tokens: 0, output_tokens: 0, cost_usd: 0, retries: 0 };
    return {
      input_tokens: typeof value.input_tokens === "number" ? value.input_tokens : 0,
      output_tokens: typeof value.output_tokens === "number" ? value.output_tokens : 0,
      cost_usd: typeof value.cost_usd === "number" ? value.cost_usd : 0,
      retries: typeof value.retries === "number" ? value.retries : 0,
    };
  } catch {
    return { input_tokens: 0, output_tokens: 0, cost_usd: 0, retries: 0 };
  }
}

export async function runEvalPlan(plan: EvalPlan): Promise<RunResult[]> {
  const runs: RunResult[] = [];
  for (const variant of plan.variants) {
    const started = performance.now();
    const proc = Bun.spawn(plan.command, {
      cwd: join(variant.sandbox, "work"),
      env: {
        PATH: process.env.PATH,
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        LC_CTYPE: process.env.LC_CTYPE,
        TZ: process.env.TZ,
        TERM: process.env.TERM,
        USER: process.env.USER,
        LOGNAME: process.env.LOGNAME,
        SHELL: process.env.SHELL,
        HOME: join(variant.sandbox, "home"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const durationMs = performance.now() - started;
    const usage = await readUsage(join(variant.sandbox, "work", ".eval-usage.json"));
    let chainOk = true;
    const chainViolations: string[] = [];
    if (variant.transcript) {
      const transcriptPath = join(variant.sandbox, variant.transcript);
      try {
        assertPathWithin(variant.sandbox, transcriptPath);
        const summary = await collectTranscript({ transcriptPath, allowedRoot: variant.sandbox });
        chainOk = summary.violations.length === 0;
        chainViolations.push(...summary.violations);
      } catch (error) {
        chainOk = false;
        chainViolations.push(error instanceof Error ? error.message : String(error));
      }
    }
    runs.push({
      variant: variant.name,
      exit_code: exitCode,
      duration_ms: durationMs,
      cost_usd: usage.cost_usd,
      retries: usage.retries,
      stdout,
      stderr,
      chain_ok: chainOk,
      chain_violations: chainViolations,
    });
  }
  return runs;
}
