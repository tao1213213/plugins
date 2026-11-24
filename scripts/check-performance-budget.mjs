#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function validator(schemaName) {
  const schema = JSON.parse(readFileSync(resolve(ROOT, `schemas/${schemaName}`), "utf8"));
  return new Ajv2020({ strict: false, allErrors: true }).compile(schema);
}

export async function checkPerformanceBudget({ root, budgetsPath, metricsPath }) {
  const budgets = JSON.parse(await readFile(resolve(root, budgetsPath), "utf8"));
  const metrics = JSON.parse(await readFile(resolve(root, metricsPath), "utf8"));
  const errors = [];
  const validateBudgets = validator("performance-budget.schema.json");
  const validateMetrics = validator("repo-metrics.schema.json");
  if (!validateBudgets(budgets)) errors.push(`budgets: ${JSON.stringify(validateBudgets.errors)}`);
  if (!validateMetrics(metrics)) errors.push(`metrics: ${JSON.stringify(validateMetrics.errors)}`);
  if (errors.length > 0) return { ok: false, errors, checked: 0 };
  if (metrics.status !== "ok") return { ok: false, errors: ["metrics status is INCONCLUSIVE"], checked: budgets.budgets.length };
  for (const budget of budgets.budgets) {
    const value = metrics.metrics[budget.name];
    if (typeof value !== "number") {
      errors.push(`missing metric ${budget.name}`);
      continue;
    }
    if (budget.min !== undefined && value < budget.min) errors.push(`${budget.name} below min ${budget.min}: ${value}`);
    if (budget.max !== undefined && value > budget.max) errors.push(`${budget.name} above max ${budget.max}: ${value}`);
  }
  return { ok: errors.length === 0, errors, checked: budgets.budgets.length };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index === -1 ? fallback : args[index + 1];
  };
  const result = await checkPerformanceBudget({ root: value("--root", process.cwd()), budgetsPath: value("--budgets", "performance-budgets.json"), metricsPath: value("--metrics", "repo-metrics.json") });
  if (!result.ok) {
    for (const error of result.errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS performance budget checked ${result.checked} metrics`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
