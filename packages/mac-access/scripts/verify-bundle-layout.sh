#!/bin/bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 /path/to/evaOS Mac Access.app" >&2
  exit 64
fi

APP_PATH=$1
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PLIST_BUDDY=/usr/libexec/PlistBuddy

fail() {
  echo "bundle layout verification failed: $1" >&2
  exit 1
}

assert_file() {
  [ -f "$1" ] || fail "missing file $1"
}

assert_bundle_value() {
  bundle=$1
  key=$2
  expected=$3
  actual=$($PLIST_BUDDY -c "Print :$key" "$bundle/Contents/Info.plist")
  [ "$actual" = "$expected" ] || fail "$bundle $key was '$actual', expected '$expected'"
}

HELPER_PATH="$APP_PATH/Contents/XPCServices/evaOS Mac Access Helper.xpc"
CONNECTOR_PATH="$APP_PATH/Contents/Library/LoginItems/evaOS Mac Access Connector.app"

assert_file "$APP_PATH/Contents/MacOS/evaOS Mac Access"
assert_file "$HELPER_PATH/Contents/MacOS/evaOS Mac Access Helper"
assert_file "$CONNECTOR_PATH/Contents/MacOS/evaOS Mac Access Connector"

assert_bundle_value "$APP_PATH" CFBundleIdentifier com.evaos.mac-access
assert_bundle_value "$APP_PATH" LSUIElement true
assert_bundle_value "$HELPER_PATH" CFBundleIdentifier com.evaos.mac-access.helper
assert_bundle_value "$CONNECTOR_PATH" CFBundleIdentifier com.evaos.mac-access.connector
assert_bundle_value "$CONNECTOR_PATH" LSUIElement true

if grep -Fq 'CODE_SIGN_ENTITLEMENTS' "$PACKAGE_ROOT/MacAccess.xcodeproj/project.pbxproj"; then
  fail 'production entitlements are forbidden in the A2 local-only project'
fi
if find "$PACKAGE_ROOT" -type f -name '*.entitlements' -print -quit | grep -q .; then
  fail 'an entitlements file exists in the A2 local-only package'
fi
if grep -Eq 'packages/desktop|/usr/bin/python|/opt/homebrew|/usr/local/bin/python' \
  "$PACKAGE_ROOT/MacAccess.xcodeproj/project.pbxproj"; then
  fail 'project contains a Workbench or customer-managed Python build dependency'
fi

for executable in \
  "$APP_PATH/Contents/MacOS/evaOS Mac Access" \
  "$HELPER_PATH/Contents/MacOS/evaOS Mac Access Helper" \
  "$CONNECTOR_PATH/Contents/MacOS/evaOS Mac Access Connector"; do
  if otool -L "$executable" | grep -Ei 'Electron|Workbench|Python|Homebrew'; then
    fail "forbidden runtime dependency in $executable"
  fi
done

echo "Verified standalone local-only bundle layout: $APP_PATH"
