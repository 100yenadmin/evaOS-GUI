#!/usr/bin/env bash

set -euo pipefail

OUTPUT_DIR="${1:-release-assets}"
INCLUDE_WEB_CLI_ASSETS="${INCLUDE_WEB_CLI_ASSETS:-0}"
MOCK_VERSION="${MOCK_VERSION:-1.0.0}"
MOCK_PRODUCT_NAME="${MOCK_PRODUCT_NAME:-evaOS Workbench Beta}"
ERRORS=0
shopt -s nullglob

for f in latest.yml latest-mac.yml latest-linux.yml latest-linux-arm64.yml; do
  if [ ! -f "$OUTPUT_DIR/$f" ]; then
    echo "FAIL: missing canonical metadata: $f"
    ERRORS=$((ERRORS + 1))
  fi
done

extract_ref_file() {
  local metadata_file="$1"
  local ref
  ref=$(grep -E '^path:' "$metadata_file" | head -n 1 | sed -E 's/^path:[[:space:]]*//')
  if [ -z "$ref" ]; then
    ref=$(grep -E '^[[:space:]]*-?[[:space:]]*url:' "$metadata_file" | head -n 1 | sed -E 's/^[[:space:]]*-?[[:space:]]*url:[[:space:]]*//')
  fi
  echo "$ref"
}

assert_metadata_points_to_existing_file() {
  local metadata_name="$1"
  local expected_pattern="$2"
  local metadata_path="$OUTPUT_DIR/$metadata_name"

  local ref_file
  ref_file=$(extract_ref_file "$metadata_path")

  if [ -z "$ref_file" ]; then
    echo "FAIL: $metadata_name has no path/url entry"
    ERRORS=$((ERRORS + 1))
    return
  fi

  if [[ ! "$ref_file" =~ $expected_pattern ]]; then
    echo "FAIL: $metadata_name points to unexpected file: $ref_file"
    ERRORS=$((ERRORS + 1))
    return
  fi

  if [ ! -f "$OUTPUT_DIR/$ref_file" ]; then
    echo "FAIL: $metadata_name references missing file: $ref_file"
    ERRORS=$((ERRORS + 1))
    return
  fi

  echo "PASS: $metadata_name -> $ref_file"
}

assert_metadata_points_to_existing_file "latest.yml" "(win-x64|win32-x64|x64)"
assert_metadata_points_to_existing_file "latest-mac.yml" "(mac-x64|darwin-x64|x64)"
assert_metadata_points_to_existing_file "latest-linux.yml" "(linux|AppImage|deb)"
assert_metadata_points_to_existing_file "latest-linux-arm64.yml" "(arm64|aarch64)"

for f in latest-win-arm64.yml latest-arm64-mac.yml; do
  if [ ! -f "$OUTPUT_DIR/$f" ]; then
    echo "FAIL: missing arch-specific updater metadata: $f"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: $f exists"
  fi
done

for f in \
  "${MOCK_PRODUCT_NAME}-${MOCK_VERSION}-win-x64.exe" \
  "${MOCK_PRODUCT_NAME}-${MOCK_VERSION}-win-arm64.exe" \
  "${MOCK_PRODUCT_NAME}-${MOCK_VERSION}-mac-x64.dmg" \
  "${MOCK_PRODUCT_NAME}-${MOCK_VERSION}-mac-arm64.dmg" \
  "${MOCK_PRODUCT_NAME}-${MOCK_VERSION}-linux-x64.deb" \
  "${MOCK_PRODUCT_NAME}-${MOCK_VERSION}-linux-arm64.deb"; do
  if [ ! -f "$OUTPUT_DIR/$f" ]; then
    echo "FAIL: missing distributable: $f"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: $f exists"
  fi
done

if [ "$INCLUDE_WEB_CLI_ASSETS" = "1" ]; then
  # Web-CLI tarballs + checksums
  for plat in darwin-arm64 darwin-x86_64 linux-arm64 linux-x86_64 win-x86_64; do
    tarball="aionui-web-${MOCK_VERSION}-${plat}.tar.gz"
    for f in "$tarball" "${tarball}.sha256"; do
      if [ ! -f "$OUTPUT_DIR/$f" ]; then
        echo "FAIL: missing web-cli asset: $f"
        ERRORS=$((ERRORS + 1))
      else
        echo "PASS: $f exists"
      fi
    done
  done

  if [ ! -f "$OUTPUT_DIR/install-web.sh" ]; then
    echo "FAIL: missing install-web.sh"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: install-web.sh exists"
  fi
else
  WEB_CLI_ASSETS=("$OUTPUT_DIR"/aionui-web-*.tar.gz "$OUTPUT_DIR"/aionui-web-*.tar.gz.sha256)
  if [ -f "$OUTPUT_DIR/install-web.sh" ]; then
    WEB_CLI_ASSETS+=("$OUTPUT_DIR/install-web.sh")
  fi
  if [ "${#WEB_CLI_ASSETS[@]}" -gt 0 ]; then
    echo "FAIL: web-cli assets are excluded for beta releases but were found:"
    printf '  %s\n' "${WEB_CLI_ASSETS[@]}"
    ERRORS=$((ERRORS + ${#WEB_CLI_ASSETS[@]}))
  else
    echo "PASS: web-cli assets are excluded"
  fi
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "FAILED: $ERRORS errors found"
  exit 1
fi

echo "ALL CHECKS PASSED"
