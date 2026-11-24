# Eval runner

Host-neutral infrastructure for isolated skill comparisons. It prepares anonymous sandboxes, runs a supplied command, collects optional usage and transcript evidence, and emits a promotion scorecard. It does not choose a model or pretend that cross-model execution happened.

## Commands

```bash
bun run eval prepare \
  --root /tmp/skill-run \
  --prompt prompt.txt \
  --variants variants.json \
  --rubric rubric.json \
  --command '["node","agent.mjs"]' \
  --output plan.json

bun run eval run --plan plan.json --output runs.json

bun run eval check \
  --plan plan.json \
  --runs runs.json \
  --scores scores.json \
  --baseline proj-alpha \
  --candidate proj-beta \
  --max-cost-ratio 1.5 \
  --output scorecard.json
```

`variants.json` contains at least two `{name, source, transcript?}` entries. Names must be project-shaped and pass the blinding check. `rubric.json` contains 3–6 `{id, description}` criteria. `scores.json` maps each variant name to its anonymous judge scores.

A variant can write `.eval-usage.json` in its work directory with `input_tokens`, `output_tokens`, `cost_usd`, and `retries`. If a transcript path is declared, the runner parses only that path inside the variant sandbox and fails the chain check on network tools or out-of-root reads.

`check` exits non-zero unless outcome, cost, blinding, transcript chain, and critical-regression gates all pass.

## Promotion and rollback

A ready scorecard can promote a candidate directory into a file-system registry. Promotion copies the candidate into a content-addressed release, atomically updates `active.json`, keeps prior releases, and appends to `audit.jsonl`.

```bash
node scripts/promote-skill.mjs \
  --registry /tmp/skill-registry \
  --candidate-root /tmp/candidates \
  --candidate /tmp/candidates/search \
  --scorecard scorecard.json \
  --skill search

node scripts/rollback-skill.mjs \
  --registry /tmp/skill-registry \
  --skill search \
  --to <release-id> \
  --dry-run
```

Remove `--dry-run` to apply the rollback. The scripts never touch a user-level skill directory unless that exact directory is passed as `--registry`.

For high-risk operations, pass `--require-approval --approval <file> --as-of <YYYY-MM-DD>`. The approval must match `promote-skill` or `rollback-skill`, name an approver and ticket, and be unexpired. Dry-run rollback does not mutate state and does not require approval.
