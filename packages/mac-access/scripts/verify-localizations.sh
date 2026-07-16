#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CATALOG="$SCRIPT_DIR/../Resources/Localizable.xcstrings"

xcrun swift "$SCRIPT_DIR/verify-localizations.swift" "$CATALOG" "$SCRIPT_DIR/../App"
