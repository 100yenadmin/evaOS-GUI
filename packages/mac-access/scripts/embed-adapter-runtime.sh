#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$PACKAGE_ROOT/../.." && pwd)
: "${TARGET_BUILD_DIR:?TARGET_BUILD_DIR is required}"
: "${UNLOCALIZED_RESOURCES_FOLDER_PATH:?UNLOCALIZED_RESOURCES_FOLDER_PATH is required}"
: "${CONFIGURATION:?CONFIGURATION is required}"

OUTPUT_ROOT="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/MacAccessRuntime"
case "$OUTPUT_ROOT" in
  "$TARGET_BUILD_DIR"/*/MacAccessRuntime) ;;
  *) echo "Refusing unsafe Mac Access runtime output path: $OUTPUT_ROOT" >&2; exit 1 ;;
esac
rm -rf "$OUTPUT_ROOT"

if [ -z "${EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR:-}" ] || [ -z "${EVAOS_CUA_DRIVER_BIN:-}" ]; then
  if [ "$CONFIGURATION" = Release ] || [ "${MAC_ACCESS_REQUIRE_ADAPTER_RUNTIME:-0}" = 1 ]; then
    echo "Mac Access Release builds require EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR and EVAOS_CUA_DRIVER_BIN." >&2
    exit 1
  fi
  echo "Skipping adapter runtime for source-only $CONFIGURATION build."
  exit 0
fi

test -x "$EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR/bin/python3"
test -x "$EVAOS_CUA_DRIVER_BIN"
test -d "$REPOSITORY_ROOT/resources/evaos-beta/bridge/src/evaos_desktop_bridge"
test -f "$PACKAGE_ROOT/Runtime/mac_access_adapter_runner.py"

mkdir -p "$OUTPUT_ROOT/bin" "$OUTPUT_ROOT/licenses" "$OUTPUT_ROOT/src"
ditto "$EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR" "$OUTPUT_ROOT/python"
ditto \
  "$REPOSITORY_ROOT/resources/evaos-beta/bridge/src/evaos_desktop_bridge" \
  "$OUTPUT_ROOT/src/evaos_desktop_bridge"
install -m 755 "$PACKAGE_ROOT/Runtime/mac_access_adapter_runner.py" "$OUTPUT_ROOT/mac_access_adapter_runner.py"
install -m 755 "$EVAOS_CUA_DRIVER_BIN" "$OUTPUT_ROOT/bin/cua-driver"
install -m 644 \
  "$PACKAGE_ROOT/Resources/Licenses/CuaDriver-LICENSE.txt" \
  "$OUTPUT_ROOT/licenses/CuaDriver-LICENSE.txt"
find "$OUTPUT_ROOT" -type d -name __pycache__ -prune -exec rm -rf {} +

"$OUTPUT_ROOT/python/bin/python3" -I -B -c '
import pathlib
import sys
root = pathlib.Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root / "src"))
from evaos_desktop_bridge.adapters.customer_mac import CustomerMacObserver
assert callable(CustomerMacObserver)
' "$OUTPUT_ROOT"
"$OUTPUT_ROOT/bin/cua-driver" manifest >/dev/null

echo "Embedded Mac Access adapter runtime: $OUTPUT_ROOT"
