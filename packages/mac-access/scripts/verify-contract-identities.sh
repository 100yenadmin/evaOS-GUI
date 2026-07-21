#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
SWIFT_IDENTITIES="$PACKAGE_ROOT/Shared/FrozenIdentities.swift"

fail() {
  echo "identity contract check failed: $1" >&2
  exit 1
}

require_in_swift() {
  value=$1
  grep -Fq -- "$value" "$SWIFT_IDENTITIES" || fail "missing from Swift identities: $value"
}

require_in_swift 'TC6MS3T6NN'
require_in_swift 'com.evaos.mac-access'
require_in_swift 'com.evaos.mac-access.helper'
require_in_swift 'com.evaos.mac-access.connector'
require_in_swift 'com.evaos.workbench'
require_in_swift 'com.electricsheephq.EvaDesktop'
require_in_swift 'com.evaos.mac-access.credentials'
require_in_swift 'com.evaos.mac-access.development.credentials'
require_in_swift 'com.evaos.mac-access.connector-credential'
require_in_swift 'com.evaos.mac-access.audit-anchor'

check_requirement_digest() {
  requirement=$1
  digest=$2
  computed=$(printf '%s' "$requirement" | shasum -a 256 | awk '{print $1}')
  [ "$computed" = "$digest" ] || fail "designated requirement digest mismatch: $digest"
  swift_requirement=$(printf '%s' "$requirement" | sed 's/"/\\"/g')
  grep -Fq -- "$swift_requirement" "$SWIFT_IDENTITIES" || fail "missing requirement from Swift identities"
  require_in_swift "$digest"
}

check_requirement_digest \
  'anchor apple generic and certificate leaf[subject.OU] = "TC6MS3T6NN" and identifier "com.evaos.mac-access"' \
  'da635352f249b4213aa1a96c41d7979d8b25d86b056b9f0929c1b414e35896fb'
check_requirement_digest \
  'anchor apple generic and certificate leaf[subject.OU] = "TC6MS3T6NN" and identifier "com.evaos.mac-access.helper"' \
  '222107bb855cfc463805777c76ca8cfdac0d1145957c5f190c234e52bfd277aa'
check_requirement_digest \
  'anchor apple generic and certificate leaf[subject.OU] = "TC6MS3T6NN" and identifier "com.evaos.mac-access.connector"' \
  '0c3de778270de5b4a1992d0e13d4f27e41929c7ace94ae143bcba92a555be422'
check_requirement_digest \
  'anchor apple generic and certificate leaf[subject.OU] = "TC6MS3T6NN" and identifier "com.evaos.workbench"' \
  'ff4fc126bb70bbf7fcc3cc0957377d67185124b5e31b19760357333a8a0ae329'
check_requirement_digest \
  'anchor apple generic and certificate leaf[subject.OU] = "TC6MS3T6NN" and identifier "com.electricsheephq.EvaDesktop"' \
  'c6038eaf8a20c83a1aabfd1bf8eb4053877b7af5627e570eb1de37721e76b776'

echo 'Frozen Swift identities and designated-requirement digests are internally consistent.'
