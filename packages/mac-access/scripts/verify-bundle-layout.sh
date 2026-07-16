#!/bin/bash
set -euo pipefail

PRIVATE_RUNTIME_SIGNED=0
if [ "$#" -eq 2 ] && [ "$1" = --signed ]; then
  PRIVATE_RUNTIME_SIGNED=1
  shift
fi
if [ "$#" -ne 1 ]; then
  echo "usage: $0 [--signed] /path/to/evaOS Mac Access.app" >&2
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

assert_bundle_missing() {
  bundle=$1
  key=$2
  if $PLIST_BUDDY -c "Print :$key" "$bundle/Contents/Info.plist" >/dev/null 2>&1; then
    fail "$bundle unexpectedly declares $key"
  fi
}

HELPER_PATH="$APP_PATH/Contents/XPCServices/evaOS Mac Access Helper.xpc"
CONNECTOR_PATH="$APP_PATH/Contents/Library/LoginItems/evaOS Mac Access Connector.app"

assert_file "$APP_PATH/Contents/MacOS/evaOS Mac Access"
assert_file "$APP_PATH/Contents/Resources/Uninstall.md"
assert_file "$HELPER_PATH/Contents/MacOS/evaOS Mac Access Helper"
assert_file "$CONNECTOR_PATH/Contents/MacOS/evaOS Mac Access Connector"
if [ "$PRIVATE_RUNTIME_SIGNED" = 1 ]; then
  assert_file "$HELPER_PATH/Contents/embedded.provisionprofile"
fi

assert_bundle_value "$APP_PATH" CFBundleIdentifier com.evaos.mac-access
assert_bundle_value "$APP_PATH" LSUIElement true
assert_bundle_value "$HELPER_PATH" CFBundleIdentifier com.evaos.mac-access.helper
assert_bundle_value "$CONNECTOR_PATH" CFBundleIdentifier com.evaos.mac-access.connector
assert_bundle_value "$CONNECTOR_PATH" LSBackgroundOnly true
assert_bundle_missing "$CONNECTOR_PATH" LSUIElement

DEBUG_ENTITLEMENTS="$PACKAGE_ROOT/Resources/Entitlements/Helper-Debug.entitlements"
RELEASE_ENTITLEMENTS="$PACKAGE_ROOT/Resources/Entitlements/Helper-Release.entitlements"
assert_file "$DEBUG_ENTITLEMENTS"
assert_file "$RELEASE_ENTITLEMENTS"

entitlements_count=$(find "$PACKAGE_ROOT" -type f -name '*.entitlements' | wc -l | tr -d ' ')
[ "$entitlements_count" = 2 ] || fail "expected exactly two helper entitlement files, found $entitlements_count"
debug_setting_count=$(grep -Fc 'CODE_SIGN_ENTITLEMENTS = "Resources/Entitlements/Helper-Debug.entitlements";' \
  "$PACKAGE_ROOT/MacAccess.xcodeproj/project.pbxproj")
release_setting_count=$(grep -Fc 'CODE_SIGN_ENTITLEMENTS = "Resources/Entitlements/Helper-Release.entitlements";' \
  "$PACKAGE_ROOT/MacAccess.xcodeproj/project.pbxproj")
[ "$debug_setting_count" = 1 ] || fail 'Debug must use only Helper-Debug.entitlements'
[ "$release_setting_count" = 1 ] || fail 'Release must use only Helper-Release.entitlements'
all_setting_count=$(grep -Fc 'CODE_SIGN_ENTITLEMENTS' "$PACKAGE_ROOT/MacAccess.xcodeproj/project.pbxproj")
[ "$all_setting_count" = 2 ] || fail 'only the helper Debug and Release targets may declare entitlements'

debug_group=$($PLIST_BUDDY -c 'Print :keychain-access-groups:0' "$DEBUG_ENTITLEMENTS")
release_group=$($PLIST_BUDDY -c 'Print :keychain-access-groups:0' "$RELEASE_ENTITLEMENTS")
debug_application_id=$($PLIST_BUDDY -c 'Print :com.apple.application-identifier' "$DEBUG_ENTITLEMENTS")
release_application_id=$($PLIST_BUDDY -c 'Print :com.apple.application-identifier' "$RELEASE_ENTITLEMENTS")
debug_team_id=$($PLIST_BUDDY -c 'Print :com.apple.developer.team-identifier' "$DEBUG_ENTITLEMENTS")
release_team_id=$($PLIST_BUDDY -c 'Print :com.apple.developer.team-identifier' "$RELEASE_ENTITLEMENTS")
[ "$debug_application_id" = 'TC6MS3T6NN.com.evaos.mac-access.helper' ] || \
  fail "unexpected Debug application identifier $debug_application_id"
[ "$release_application_id" = 'TC6MS3T6NN.com.evaos.mac-access.helper' ] || \
  fail "unexpected Release application identifier $release_application_id"
[ "$debug_team_id" = 'TC6MS3T6NN' ] || fail "unexpected Debug Team ID $debug_team_id"
[ "$release_team_id" = 'TC6MS3T6NN' ] || fail "unexpected Release Team ID $release_team_id"
[ "$debug_group" = 'TC6MS3T6NN.com.evaos.mac-access.development.credentials.epoch-1' ] || \
  fail "unexpected Debug Keychain group $debug_group"
[ "$release_group" = 'TC6MS3T6NN.com.evaos.mac-access.credentials.epoch-1' ] || \
  fail "unexpected Release Keychain group $release_group"
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

if [ "${MAC_ACCESS_REQUIRE_PRIVATE_RUNTIME:-0}" = 1 ]; then
  if [ "$PRIVATE_RUNTIME_SIGNED" = 1 ]; then
    "$SCRIPT_DIR/verify-private-runtime.sh" --signed "$APP_PATH"
  else
    "$SCRIPT_DIR/verify-private-runtime.sh" "$APP_PATH"
  fi
fi

echo "Verified standalone Mac Access bundle layout and helper-only Keychain groups: $APP_PATH"
