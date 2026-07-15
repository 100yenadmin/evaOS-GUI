#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:?repository root is required}"
runtime_dir="${2:?private Python runtime directory is required}"
proof_root="${3:?proof output directory is required}"
resource_dir="$proof_root/Bridge"
poison_dir="$proof_root/poison-bin"
poison_marker="$proof_root/ambient-dependency-used"

test -x "$runtime_dir/bin/python3"
mkdir -p "$poison_dir"
for command in python python3 pip pip3 brew; do
  printf '#!/bin/sh\nprintf "%%s\\n" "$0" >> "%s"\nexit 97\n' "$poison_marker" > "$poison_dir/$command"
  chmod 755 "$poison_dir/$command"
done

EVAOS_DESKTOP_BRIDGE_RESOURCE_DIR="$resource_dir" \
EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR="$runtime_dir" \
node "$repo_root/scripts/prepareEvaosDesktopBridgeResource.js"

test -x "$resource_dir/python/bin/python3"
test -x "$resource_dir/evaos-desktop-bridge"
test -f "$resource_dir/src/evaos_desktop_bridge/host/api.py"

PATH="$poison_dir" \
PYTHONHOME=/poison/python-home \
PYTHONPATH=/poison/python-path \
VIRTUAL_ENV=/poison/virtualenv \
PIP_CONFIG_FILE=/poison/pip.conf \
DYLD_LIBRARY_PATH=/poison/dyld-library \
DYLD_FRAMEWORK_PATH=/poison/dyld-framework \
"$resource_dir/evaos-desktop-bridge" --help >/dev/null

PATH="$poison_dir" \
PYTHONHOME=/poison/python-home \
PYTHONPATH=/poison/python-path \
VIRTUAL_ENV=/poison/virtualenv \
PIP_CONFIG_FILE=/poison/pip.conf \
DYLD_LIBRARY_PATH=/poison/dyld-library \
DYLD_FRAMEWORK_PATH=/poison/dyld-framework \
"$resource_dir/python/bin/python3" -I -B -c '
import pathlib
import runpy
import sys
resource = pathlib.Path(sys.argv.pop(1)).resolve()
repo = pathlib.Path(sys.argv.pop(1)).resolve()
assert pathlib.Path(sys.executable).resolve().is_relative_to(resource / "python")
assert sys.flags.isolated == 1
assert sys.dont_write_bytecode
sys.path.insert(0, str(resource / "src"))
sys.path.insert(0, str(repo / "packages/mac-connector-core/tests/python"))
runpy.run_module("test_host_api", run_name="__main__", alter_sys=True)
' "$resource_dir" "$repo_root"

test ! -e "$poison_marker"
if find "$resource_dir" -type d -name __pycache__ -print -quit | grep -q .; then
  echo "Embedded connector proof generated forbidden __pycache__ state." >&2
  exit 1
fi
