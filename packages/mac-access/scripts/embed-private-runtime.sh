#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${TARGET_BUILD_DIR:?TARGET_BUILD_DIR is required}"
: "${UNLOCALIZED_RESOURCES_FOLDER_PATH:?UNLOCALIZED_RESOURCES_FOLDER_PATH is required}"
: "${CONFIGURATION:?CONFIGURATION is required}"

OUTPUT_ROOT="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/MacConnectorCore"
case "$OUTPUT_ROOT" in
  "$TARGET_BUILD_DIR"/*/MacConnectorCore) ;;
  *) echo "Refusing unsafe Mac Access runtime output path: $OUTPUT_ROOT" >&2; exit 1 ;;
esac

if [ -z "${EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR:-}" ]; then
  node "$SCRIPT_DIR/prepare-private-runtime.js" clean "$OUTPUT_ROOT"
  if [ "$CONFIGURATION" = Release ] || [ "${MAC_ACCESS_REQUIRE_PRIVATE_RUNTIME:-0}" = 1 ]; then
    echo "Release Mac Access builds require EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR." >&2
    exit 1
  fi
  echo "Skipping private runtime for hostless $CONFIGURATION source build."
  exit 0
fi

node "$SCRIPT_DIR/prepare-private-runtime.js" prepare "$OUTPUT_ROOT"
