# Search verification reference

This example is a deterministic, in-memory harness for the evidence contract. It is not a replacement for driving a real browser or CLI. Use it to see the required artifact shape and negative-control discipline.

## Run

From the repository root:

```bash
node examples/search-verification/run.mjs --output "$RUNNER_TEMP/search-evidence"
node scripts/check-verification-evidence.mjs \
  --root "$RUNNER_TEMP/search-evidence" \
  --manifest "$RUNNER_TEMP/search-evidence/evidence.json" \
  --inventory examples/search-verification/surface-inventory.json
```

On Windows, use `%TEMP%\\search-evidence` instead of `$RUNNER_TEMP/search-evidence`.

## Covered claims

- `search-match`: matching note appears and non-matching note is absent.
- `search-empty`: explicit empty state appears.
- `search-keyboard`: slash opens search without inserting a slash.
- `search-cli`: CLI JSON matches the expected result and exits zero.

Each claim runs a happy path and a deliberate break. The break must raise an assertion at the claim that names the behavior. The harness records the caught failure, artifact SHA256, exit code, cleanup state, and coverage counts in `evidence.json`.

## Why this matters

A green happy path only proves the harness ran. The negative control proves the harness can fail. The evidence validator proves the artifacts exist, were not modified, stay inside the evidence root, and were not cleaned up with the test processes.
