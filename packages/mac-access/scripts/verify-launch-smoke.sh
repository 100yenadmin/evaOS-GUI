#!/bin/bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 /path/to/evaOS Mac Access.app" >&2
  exit 64
fi

APP_PATH=$1
EXECUTABLE="$APP_PATH/Contents/MacOS/evaOS Mac Access"
test -x "$EXECUTABLE"

OUTPUT=$(mktemp "${TMPDIR:-/tmp}/evaos-mac-access-launch.XXXXXX")
PID=
cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill -TERM "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -f "$OUTPUT"
}
trap cleanup EXIT

"$EXECUTABLE" >"$OUTPUT" 2>&1 &
PID=$!
sleep 3

if ! kill -0 "$PID" 2>/dev/null; then
  set +e
  wait "$PID"
  status=$?
  set -e
  cat "$OUTPUT" >&2
  echo "Mac Access launch smoke failed: process exited with status $status." >&2
  exit 1
fi

echo "Verified Mac Access remains alive after launch: $APP_PATH"
