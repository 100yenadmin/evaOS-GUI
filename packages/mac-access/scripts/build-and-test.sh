#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DERIVED_DATA_PATH=${DERIVED_DATA_PATH:-"${TMPDIR:-/tmp}/evaos-mac-access-derived-data"}

"$SCRIPT_DIR/verify-contract-identities.sh"
"$SCRIPT_DIR/verify-localizations.sh"
PYTHONDONTWRITEBYTECODE=1 python3 "$PACKAGE_ROOT/Tests/AdapterRunnerTests.py"

xcodebuild \
  -project "$PACKAGE_ROOT/MacAccess.xcodeproj" \
  -scheme MacAccess \
  -configuration Debug \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  clean build

xcodebuild \
  -project "$PACKAGE_ROOT/MacAccess.xcodeproj" \
  -scheme MacAccess \
  -configuration Debug \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  build-for-testing

xcrun xctest "$DERIVED_DATA_PATH/Build/Products/Debug/MacAccessTests.xctest"

"$SCRIPT_DIR/verify-bundle-layout.sh" \
  "$DERIVED_DATA_PATH/Build/Products/Debug/evaOS Mac Access.app"
