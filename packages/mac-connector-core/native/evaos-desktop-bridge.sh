#!/bin/sh
set -eu

PATH="/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
BRIDGE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PYTHON_BIN="$BRIDGE_DIR/python/bin/python3"

if [ ! -x "$PYTHON_BIN" ]; then
  echo "evaos-desktop-bridge: bundled Python runtime is missing. Reinstall evaOS Workbench or contact Electric Sheep support." >&2
  exit 127
fi

unset PYTHONHOME
unset PYTHONUSERBASE
unset PYTHONPATH
unset VIRTUAL_ENV
unset PIP_CONFIG_FILE
unset PIP_REQUIRE_VIRTUALENV
unset PIP_USER
unset DYLD_LIBRARY_PATH
unset DYLD_FRAMEWORK_PATH
unset DYLD_INSERT_LIBRARIES
export PYTHONNOUSERSITE=1
export PATH="$BRIDGE_DIR/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1

CACHE_ROOT="${EVAOS_DESKTOP_BRIDGE_CACHE_DIR:-}"
if [ -z "$CACHE_ROOT" ]; then
  if [ -n "${HOME:-}" ]; then
    CACHE_ROOT="$HOME/Library/Caches/evaos-desktop-bridge"
  else
    CACHE_ROOT="/tmp/evaos-desktop-bridge-cache"
  fi
fi
mkdir -p "$CACHE_ROOT/pycache" 2>/dev/null || true
export PYTHONPYCACHEPREFIX="$CACHE_ROOT/pycache"

PYTHON_MODULE="evaos_desktop_bridge.host.cli"
case "${1:-}" in
  pre-canary)
    PYTHON_MODULE="evaos_desktop_bridge.proof.pre_canary"
    shift
    ;;
  qa-canary)
    PYTHON_MODULE="evaos_desktop_bridge.proof.qa_canary"
    shift
    ;;
esac

PYTHON_BOOTSTRAP='import runpy, sys; source_root = sys.argv.pop(1); module = sys.argv.pop(1); sys.path.insert(0, source_root); runpy.run_module(module, run_name="__main__", alter_sys=True)'
exec "$PYTHON_BIN" -I -B -c "$PYTHON_BOOTSTRAP" "$BRIDGE_DIR/src" "$PYTHON_MODULE" "$@"
