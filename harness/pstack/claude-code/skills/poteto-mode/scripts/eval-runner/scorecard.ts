export type RunSummary = {
  variant: string;
  exit_code: number;
  duration_ms: number;
  cost_usd: number;
  retries: number;
};

export type Scorecard = {
  schema_version: "1.0";
  promotion_ready: boolean;
  blockers: string[];
  baseline_total: number;
  candidate_total: number;
  baseline_cost: number;
  candidate_cost: number;
  cost_ratio: number;
  baseline_pass_rate: number;
  candidate_pass_rate: number;
};

function total(scores: number[] | undefined): number {
  return scores?.reduce((sum, value) => sum + value, 0) ?? 0;
}

function passRate(runs: RunSummary[], variant: string): number {
  const selected = runs.filter((run) => run.variant === variant);
  if (selected.length === 0) return 0;
  return selected.filter((run) => run.exit_code === 0).length / selected.length;
}

function cost(runs: RunSummary[], variant: string): number {
  return runs.filter((run) => run.variant === variant).reduce((sum, run) => sum + run.cost_usd, 0);
}

export function buildScorecard(input: {
  runs: RunSummary[];
  judgeScores: Record<string, number[]>;
  baseline: string;
  candidate: string;
  maxCostRatio: number;
  blindingOk: boolean;
  chainOk: boolean;
  criticalRegressions: number;
}): Scorecard {
  const blockers: string[] = [];
  const baselineCost = cost(input.runs, input.baseline);
  const candidateCost = cost(input.runs, input.candidate);
  const costRatio = baselineCost === 0 ? (candidateCost === 0 ? 1 : Number.POSITIVE_INFINITY) : candidateCost / baselineCost;
  const baselinePassRate = passRate(input.runs, input.baseline);
  const candidatePassRate = passRate(input.runs, input.candidate);
  if (candidatePassRate < baselinePassRate) blockers.push("outcome regressed");
  if (costRatio > input.maxCostRatio) blockers.push(`cost ratio ${costRatio.toFixed(2)} exceeds ${input.maxCostRatio}`);
  if (!input.blindingOk) blockers.push("blinding check failed");
  if (!input.chainOk) blockers.push("chain check failed");
  if (input.criticalRegressions > 0) blockers.push(`critical regressions: ${input.criticalRegressions}`);
  return {
    schema_version: "1.0",
    promotion_ready: blockers.length === 0,
    blockers,
    baseline_total: total(input.judgeScores[input.baseline]),
    candidate_total: total(input.judgeScores[input.candidate]),
    baseline_cost: baselineCost,
    candidate_cost: candidateCost,
    cost_ratio: costRatio,
    baseline_pass_rate: baselinePassRate,
    candidate_pass_rate: candidatePassRate,
  };
}
