export type VariantSpec = {
  name: string;
  source: string;
};

export type RubricCriterion = {
  id: string;
  description: string;
};

export type PlannedVariant = VariantSpec & {
  sandbox: string;
  transcript?: string;
};

export type EvalPlan = {
  schema_version: "1.0";
  prompt: string;
  variants: PlannedVariant[];
  rubric: RubricCriterion[];
  command: string[];
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  retries: number;
};

export type RunResult = {
  variant: string;
  exit_code: number;
  duration_ms: number;
  cost_usd: number;
  retries: number;
  stdout: string;
  stderr: string;
  chain_ok: boolean;
  chain_violations: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("expected an array of strings");
  }
  return value;
}

export function parseVariants(value: unknown): VariantSpec[] {
  if (!Array.isArray(value) || value.length < 2) throw new Error("variants must contain at least two entries");
  return value.map((item) => {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.source !== "string") {
      throw new Error("each variant requires name and source strings");
    }
    const transcript = typeof item.transcript === "string" ? { transcript: item.transcript } : {};
    return { name: item.name, source: item.source, ...transcript };
  });
}

export function parseRubric(value: unknown): RubricCriterion[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 6) throw new Error("rubric must contain 3 to 6 criteria");
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.description !== "string") {
      throw new Error("each rubric criterion requires id and description strings");
    }
    return { id: item.id, description: item.description };
  });
}

export function parseCommand(value: unknown): string[] {
  const command = stringArray(value);
  if (command.length === 0) throw new Error("command cannot be empty");
  return command;
}

export function parseEvalPlan(value: unknown): EvalPlan {
  if (!isRecord(value) || value.schema_version !== "1.0" || typeof value.prompt !== "string") {
    throw new Error("invalid eval plan");
  }
  if (!Array.isArray(value.variants)) throw new Error("invalid eval plan variants");
  const variants = value.variants.map((item) => {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.source !== "string" || typeof item.sandbox !== "string") {
      throw new Error("invalid planned variant");
    }
    const transcript = typeof item.transcript === "string" ? { transcript: item.transcript } : {};
    return { name: item.name, source: item.source, sandbox: item.sandbox, ...transcript };
  });
  return {
    schema_version: "1.0",
    prompt: value.prompt,
    variants,
    rubric: parseRubric(value.rubric),
    command: parseCommand(value.command),
  };
}

export function parseRuns(value: unknown): RunResult[] {
  if (!Array.isArray(value)) throw new Error("runs must be an array");
  return value.map((item) => {
    if (!isRecord(item) || typeof item.variant !== "string" || typeof item.exit_code !== "number" || typeof item.duration_ms !== "number" || typeof item.cost_usd !== "number" || typeof item.retries !== "number" || typeof item.stdout !== "string" || typeof item.stderr !== "string" || typeof item.chain_ok !== "boolean" || !Array.isArray(item.chain_violations)) {
      throw new Error("invalid run result");
    }
    return {
      variant: item.variant,
      exit_code: item.exit_code,
      duration_ms: item.duration_ms,
      cost_usd: item.cost_usd,
      retries: item.retries,
      stdout: item.stdout,
      stderr: item.stderr,
      chain_ok: item.chain_ok,
      chain_violations: stringArray(item.chain_violations),
    };
  });
}

export function parseScores(value: unknown): Record<string, number[]> {
  if (!isRecord(value)) throw new Error("scores must be an object");
  const scores: Record<string, number[]> = {};
  for (const [variant, values] of Object.entries(value)) {
    if (!Array.isArray(values) || !values.every((score) => typeof score === "number")) {
      throw new Error(`invalid scores for ${variant}`);
    }
    scores[variant] = values;
  }
  return scores;
}
