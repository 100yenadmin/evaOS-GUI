#!/bin/bash
set -euo pipefail

env_output="${1:-${GITHUB_ENV:-}}"
if [ -z "$env_output" ]; then
  echo "No environment output file was provided." >&2
  exit 2
fi

: "${CUA_DRIVER_VERSION:=0.7.1}"
: "${CUA_DRIVER_RELEASE_TAG:=cua-driver-rs-v0.7.1}"
: "${CUA_DRIVER_ARCHIVE_SHA256:=43a78c1789c6f0fff12f87b5d4089e4d4da5f256832ca9a7c5f5fdaa79ba76d4}"
: "${RUNNER_TEMP:=${TMPDIR:-/tmp}}"

asset="cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-universal-binary.tar.gz"
url="https://github.com/trycua/cua/releases/download/${CUA_DRIVER_RELEASE_TAG}/${asset}"
archive="$RUNNER_TEMP/$asset"
root="$RUNNER_TEMP/evaos-cua-driver-${CUA_DRIVER_VERSION}"
binary="$root/cua-driver"

if [ ! -f "$archive" ] || ! printf '%s  %s\n' "$CUA_DRIVER_ARCHIVE_SHA256" "$archive" | shasum -a 256 -c - >/dev/null 2>&1; then
  curl --fail --location --retry 3 --output "$archive" "$url"
fi
printf '%s  %s\n' "$CUA_DRIVER_ARCHIVE_SHA256" "$archive" | shasum -a 256 -c -
rm -rf "$root"
mkdir -p "$root"
tar -xzf "$archive" -C "$root"
test -x "$binary"
test "$(lipo -archs "$binary")" = "x86_64 arm64"
test "$("$binary" --version | awk '{print $2}')" = "$CUA_DRIVER_VERSION"
codesign --verify --strict "$binary"

{
  echo "EVAOS_CUA_DRIVER_BIN=$binary"
  echo "EVAOS_REQUIRED_CUA_DRIVER_VERSION=$CUA_DRIVER_VERSION"
  echo "EVAOS_REQUIRED_CUA_DRIVER_SHA256=$CUA_DRIVER_ARCHIVE_SHA256"
  echo "EVAOS_REQUIRED_CUA_DRIVER_SOURCE_URL=$url"
} >> "$env_output"
