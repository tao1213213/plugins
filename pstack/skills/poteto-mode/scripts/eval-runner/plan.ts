import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { findBlindingLeaks } from "./blinding";
import { copyDirectory, createSandbox } from "./isolation";
import type { EvalPlan, RubricCriterion, VariantSpec } from "./types";

export async function prepareEvalPlan(input: {
  root: string;
  prompt: string;
  variants: VariantSpec[];
  rubric: RubricCriterion[];
  command: string[];
}): Promise<EvalPlan> {
  const root = resolve(input.root);
  await mkdir(root, { recursive: true });
  const variants = [];
  for (const variant of input.variants) {
    const sandbox = await createSandbox({ parent: root, name: variant.name });
    await copyDirectory(resolve(variant.source), sandbox.work);
    await writeFile(join(sandbox.work, "prompt.txt"), input.prompt);
    variants.push({ ...variant, sandbox: sandbox.root });
  }
  const plan: EvalPlan = {
    schema_version: "1.0",
    prompt: input.prompt,
    variants,
    rubric: input.rubric,
    command: input.command,
  };
  const leaks = findBlindingLeaks({
    paths: variants.flatMap((variant) => [variant.name, variant.sandbox]),
    prompt: input.prompt,
    headings: [],
  });
  if (leaks.length > 0) throw new Error(`blinding leak: ${leaks.join(", ")}`);
  return plan;
}
