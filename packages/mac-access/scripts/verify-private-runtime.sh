#!/bin/bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 /path/to/evaOS Mac Access.app" >&2
  exit 64
fi

APP_PATH=$1
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
HELPER_PATH="$APP_PATH/Contents/XPCServices/evaOS Mac Access Helper.xpc"
RESOURCE_ROOT="$HELPER_PATH/Contents/Resources/MacConnectorCore"
PYTHON="$RESOURCE_ROOT/python/bin/python3"
SOURCE="$RESOURCE_ROOT/src"
: "${MAC_ACCESS_EXPECTED_ARCH:?MAC_ACCESS_EXPECTED_ARCH is required}"

test -x "$PYTHON"
test -f "$SOURCE/evaos_desktop_bridge/host/stdio_runner.py"
node "$SCRIPT_DIR/prepare-private-runtime.js" verify "$RESOURCE_ROOT"

for executable in \
  "$APP_PATH/Contents/MacOS/evaOS Mac Access" \
  "$HELPER_PATH/Contents/MacOS/evaOS Mac Access Helper" \
  "$APP_PATH/Contents/Library/LoginItems/evaOS Mac Access Connector.app/Contents/MacOS/evaOS Mac Access Connector" \
  "$PYTHON"; do
  actual_arch=$(lipo -archs "$executable")
  if [ "$actual_arch" != "$MAC_ACCESS_EXPECTED_ARCH" ]; then
    echo "Mac Access architecture mismatch: $executable is $actual_arch, expected $MAC_ACCESS_EXPECTED_ARCH." >&2
    exit 1
  fi
done

PROOF_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/evaos-mac-access-runtime.XXXXXX")
trap 'rm -rf "$PROOF_ROOT"' EXIT
POISON_BIN="$PROOF_ROOT/poison-bin"
POISON_MARKER="$PROOF_ROOT/ambient-dependency-used"
mkdir -p "$POISON_BIN"
for command in python python3 pip pip3 brew; do
  printf '#!/bin/sh\nprintf "%%s\\n" "$0" >> "%s"\nexit 97\n' "$POISON_MARKER" > "$POISON_BIN/$command"
  chmod 755 "$POISON_BIN/$command"
done

PATH="$POISON_BIN" \
PYTHONHOME=/poison/python-home \
PYTHONPATH=/poison/python-path \
VIRTUAL_ENV=/poison/virtualenv \
PIP_CONFIG_FILE=/poison/pip.conf \
DYLD_LIBRARY_PATH=/poison/dyld-library \
DYLD_FRAMEWORK_PATH=/poison/dyld-framework \
"$PYTHON" -I -B -c '
import pathlib
import sys
source = pathlib.Path(sys.argv[1]).resolve()
resource = source.parent.resolve()
assert pathlib.Path(sys.executable).resolve().is_relative_to(resource / "python")
assert sys.flags.isolated == 1
assert sys.dont_write_bytecode
sys.path.insert(0, str(source))
from evaos_desktop_bridge.host import stdio_runner
assert callable(stdio_runner.main)
' "$SOURCE"

test ! -e "$POISON_MARKER"
if find "$RESOURCE_ROOT" -type d -name __pycache__ -print -quit | grep -q .; then
  echo "Mac Access private runtime generated forbidden __pycache__ state." >&2
  exit 1
fi

echo "Verified embedded Mac Access private runtime without ambient Python, pip, brew, or DYLD state: $RESOURCE_ROOT"
