#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateEvidence } from "./validate-evidence.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INVENTORY_SCHEMA = resolve(ROOT, "schemas/surface-inventory.schema.json");

export async function checkVerificationEvidence({ root, manifestPath, inventoryPath }) {
  const errors = [];
  let evidence;
  try {
    evidence = await validateEvidence({ root, manifestPath });
  } catch (error) {
    return { ok: false, errors: [`manifest unreadable: ${error.message}`], checked: 0 };
  }
  if (!evidence.ok) errors.push(...evidence.errors.map((error) => `evidence: ${error}`));

  let inventory;
  try {
    inventory = JSON.parse(await readFile(resolve(inventoryPath), "utf8"));
  } catch (error) {
    errors.push(`inventory unreadable: ${error.message}`);
    return { ok: false, errors, checked: evidence.checked };
  }

  const schema = JSON.parse(await readFile(INVENTORY_SCHEMA, "utf8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(inventory)) {
    for (const error of validate.errors ?? []) {
      errors.push(`inventory: ${error.instancePath || "/"} ${error.message}`);
    }
    return { ok: false, errors, checked: evidence.checked };
  }

  const today = new Date().toISOString().slice(0, 10);
  const inventoriedClaims = new Set();
  for (const surface of inventory.surfaces) {
    const status = surface.coverage.status;
    if ((status === "verified" || status === "partial") && (surface.claim_ids?.length ?? 0) === 0) {
      errors.push(`${surface.id}: ${status} surface requires claim_ids`);
    }
    if (status === "uncovered") {
      if (!surface.waiver) {
        errors.push(`${surface.id}: uncovered surface requires a waiver`);
      } else if (surface.waiver.expires_at < today) {
        errors.push(`${surface.id}: waiver expired ${surface.waiver.expires_at}`);
      }
    }
    for (const claimId of surface.claim_ids ?? []) inventoriedClaims.add(claimId);
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  } catch (error) {
    errors.push(`manifest unreadable: ${error.message}`);
    return { ok: false, errors, checked: evidence.checked };
  }
  const evidencedClaims = new Set(manifest.claims.map((claim) => claim.claim_id));
  for (const claimId of inventoriedClaims) {
    if (!evidencedClaims.has(claimId)) errors.push(`missing evidence claim ${claimId}`);
  }
  for (const claimId of evidencedClaims) {
    if (!inventoriedClaims.has(claimId)) errors.push(`evidence claim not inventoried ${claimId}`);
  }

  return { ok: errors.length === 0, errors, checked: evidence.checked };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index === -1 ? fallback : args[index + 1];
  };
  const manifestPath = resolve(value("--manifest", "evidence.json"));
  const root = resolve(value("--root", dirname(manifestPath)));
  const inventoryPath = resolve(value("--inventory", "examples/search-verification/surface-inventory.json"));
  const result = await checkVerificationEvidence({ root, manifestPath, inventoryPath });
  if (!result.ok) {
    for (const error of result.errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS verification gate checked ${result.checked} claims`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
