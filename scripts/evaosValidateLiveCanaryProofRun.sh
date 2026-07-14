#!/bin/bash
set -euo pipefail

if [ -z "${LIVE_CANARY_PROOF_RUN_ID:-}" ]; then
  echo "::error::live_canary_proof_run_id is required before public beta distribution."
  exit 1
fi
if [ -z "${GITHUB_REPOSITORY:-}" ]; then
  echo "::error::GITHUB_REPOSITORY is required to validate the selected proof run."
  exit 1
fi

MAC_CONTROL_PROOF_REQUIRED=$(node scripts/evaosBetaReleaseGate.js requires-mac-control-proof "$TAG")

RUN_JSON=$(gh run view "$LIVE_CANARY_PROOF_RUN_ID" --repo "$GITHUB_REPOSITORY" --json conclusion,event,workflowName,headSha)
node - "$RUN_JSON" "$EXPECTED_RELEASE_COMMIT" <<'NODE'
const run = JSON.parse(process.argv[2]);
const expectedHead = process.argv[3];
if (run.conclusion !== 'success') {
  throw new Error(`Live canary proof run did not succeed: ${run.conclusion}`);
}
const expectedWorkflowNames = new Set([
  'evaOS Live Canary Proof',
  '.github/workflows/evaos-live-canary-proof.yml',
]);
if (!expectedWorkflowNames.has(run.workflowName)) {
  throw new Error(`Live canary proof run used unexpected workflow: ${run.workflowName}`);
}
if (run.event !== 'workflow_dispatch') {
  throw new Error(`Live canary proof run was not manually dispatched: ${run.event}`);
}
if (run.headSha !== expectedHead) {
  throw new Error(`Live canary proof head ${run.headSha} does not match release commit ${expectedHead}.`);
}
NODE

rm -rf live-canary-proof-download live-canary-proof
mkdir -p live-canary-proof-download
gh run download "$LIVE_CANARY_PROOF_RUN_ID" \
  --repo "$GITHUB_REPOSITORY" \
  --name "evaos-live-canary-proof-${LIVE_CANARY_PROOF_RUN_ID}" \
  --dir live-canary-proof-download

mapfile -t BROKER_PROOFS < <(find live-canary-proof-download -type f -name broker-runtime-status.json)
if [ "${#BROKER_PROOFS[@]}" -ne 1 ]; then
  echo "::error::Live canary artifact must contain exactly one broker-runtime-status.json, found ${#BROKER_PROOFS[@]}."
  exit 1
fi
PROOF_ROOT=$(dirname "${BROKER_PROOFS[0]}")
if [ "$MAC_CONTROL_PROOF_REQUIRED" = "true" ]; then
  mapfile -t MAC_CONTROL_PROOFS < <(find live-canary-proof-download -type f -name mac-control-runtime.json)
  if [ "${#MAC_CONTROL_PROOFS[@]}" -ne 1 ]; then
    echo "::error::Live canary artifact must contain exactly one mac-control-runtime.json, found ${#MAC_CONTROL_PROOFS[@]}."
    exit 1
  fi
  if [ "$(dirname "${MAC_CONTROL_PROOFS[0]}")" != "$PROOF_ROOT" ]; then
    echo "::error::Broker and Mac-control live canary proofs must come from the same proof packet."
    exit 1
  fi
fi
mkdir -p live-canary-proof
cp -R "$PROOF_ROOT"/. live-canary-proof/

if ! grep -Fq "Run live canaries: true" live-canary-proof/proof-run.md; then
  echo "::error::Live canary proof run did not record run_live_canaries=true."
  exit 1
fi
if ! grep -Fq "Run follow-up canaries:" live-canary-proof/proof-run.md; then
  echo "::error::Live canary proof run did not record the follow-up canary disposition."
  exit 1
fi
if [ "$MAC_CONTROL_PROOF_REQUIRED" = "true" ] && ! grep -Fq "Run Mac-control canary: true" live-canary-proof/proof-run.md; then
  echo "::error::Live canary proof run did not record run_mac_control_canary=true."
  exit 1
fi

EVAOS_REQUIRE_MAC_CONTROL_LIVE_CANARY_PROOF="$MAC_CONTROL_PROOF_REQUIRED" \
  node scripts/evaosBetaReleaseGate.js verify-live-canary-proof live-canary-proof
