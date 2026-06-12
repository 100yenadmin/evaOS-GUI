#!/usr/bin/env bash

set -euo pipefail

OUTPUT_DIR="${1:-release-assets}"
INCLUDE_WEB_CLI_ASSETS="${INCLUDE_WEB_CLI_ASSETS:-0}"
MOCK_VERSION="${MOCK_VERSION:-1.0.0}"
MOCK_PRODUCT_NAME="${MOCK_PRODUCT_NAME:-evaOS Workbench Beta}"
RELEASE_TARGET_PLATFORMS="${EVAOS_RELEASE_TARGET_PLATFORMS:-all}"
ERRORS=0
shopt -s nullglob

case "$RELEASE_TARGET_PLATFORMS" in
  all|macos)
    ;;
  *)
    echo "FAIL: unsupported EVAOS_RELEASE_TARGET_PLATFORMS: $RELEASE_TARGET_PLATFORMS"
    echo "FAIL: supported values: all, macos"
    exit 1
    ;;
esac

echo "Release target platforms: $RELEASE_TARGET_PLATFORMS"

assert_evaos_beta_asset_identity() {
  local base="$1"

  case "$base" in
    *"AionUi"*|*"AionUI"*|*"Aion-UI"*|*"aion-ui"*|*"aionui"*)
      echo "FAIL: upstream-branded beta asset is not allowed: $base"
      ERRORS=$((ERRORS + 1))
      return
      ;;
  esac

  case "$base" in
    *"evaOS Workbench Beta"*|*"EvaOSWorkbenchBeta"*|*"evaos-workbench-beta"*)
      ;;
    *)
      echo "FAIL: beta asset lacks evaOS identity marker: $base"
      ERRORS=$((ERRORS + 1))
      ;;
  esac
}

REQUIRED_METADATA=(latest-mac.yml)
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ]; then
  REQUIRED_METADATA=(latest.yml latest-mac.yml latest-linux.yml latest-linux-arm64.yml)
fi

for f in "${REQUIRED_METADATA[@]}"; do
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

assert_metadata_points_to_existing_file "latest-mac.yml" "(mac-x64|darwin-x64|x64)"
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ]; then
  assert_metadata_points_to_existing_file "latest.yml" "(win-x64|win32-x64|x64)"
  assert_metadata_points_to_existing_file "latest-linux.yml" "(linux|AppImage|deb)"
  assert_metadata_points_to_existing_file "latest-linux-arm64.yml" "(arm64|aarch64)"
fi

ARCH_METADATA=(latest-arm64-mac.yml)
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ]; then
  ARCH_METADATA=(latest-win-arm64.yml latest-arm64-mac.yml)
fi

for f in "${ARCH_METADATA[@]}"; do
  if [ ! -f "$OUTPUT_DIR/$f" ]; then
    echo "FAIL: missing arch-specific updater metadata: $f"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: $f exists"
  fi
done

if [ -f "$OUTPUT_DIR/latest-arm64-mac.yml" ]; then
  assert_metadata_points_to_existing_file "latest-arm64-mac.yml" "(mac-arm64|darwin-arm64|arm64)"
fi

assert_required_glob() {
  local label="$1"
  local pattern="$2"
  local matches=()

  while IFS= read -r match; do
    matches+=("$match")
  done < <(find "$OUTPUT_DIR" -maxdepth 1 -type f -name "$pattern" | sort)

  if [ "${#matches[@]}" -eq 0 ]; then
    echo "FAIL: missing distributable matching $label: $pattern"
    ERRORS=$((ERRORS + 1))
    return
  fi

  local match
  for match in "${matches[@]}"; do
    echo "PASS: $(basename "$match") exists"
  done
}

if [ "$RELEASE_TARGET_PLATFORMS" = "macos" ]; then
  assert_required_glob "macOS x64 DMG" "${MOCK_PRODUCT_NAME}-*-mac-x64.dmg"
  assert_required_glob "macOS arm64 DMG" "${MOCK_PRODUCT_NAME}-*-mac-arm64.dmg"
else
  REQUIRED_DISTRIBUTABLES=(
    "${MOCK_PRODUCT_NAME}-${MOCK_VERSION}-win-x64.exe"
    "${MOCK_PRODUCT_NAME}-${MOCK_VERSION}-win-arm64.exe"
    "${MOCK_PRODUCT_NAME}-${MOCK_VERSION}-mac-x64.dmg"
    "${MOCK_PRODUCT_NAME}-${MOCK_VERSION}-mac-arm64.dmg"
    "${MOCK_PRODUCT_NAME}-${MOCK_VERSION}-linux-x64.deb"
    "${MOCK_PRODUCT_NAME}-${MOCK_VERSION}-linux-arm64.deb"
  )

  for f in "${REQUIRED_DISTRIBUTABLES[@]}"; do
    if [ ! -f "$OUTPUT_DIR/$f" ]; then
      echo "FAIL: missing distributable: $f"
      ERRORS=$((ERRORS + 1))
    else
      echo "PASS: $f exists"
    fi
  done
fi

if [ "$RELEASE_TARGET_PLATFORMS" = "macos" ]; then
  DEFERRED_PLATFORM_FILES=(
    "$OUTPUT_DIR"/*.exe
    "$OUTPUT_DIR"/*.msi
    "$OUTPUT_DIR"/*.deb
    "$OUTPUT_DIR"/latest.yml
    "$OUTPUT_DIR"/latest-win-arm64.yml
    "$OUTPUT_DIR"/latest-linux*.yml
  )
  for f in "${DEFERRED_PLATFORM_FILES[@]}"; do
    [ -e "$f" ] || continue
    echo "FAIL: macOS release profile contains deferred Windows/Linux asset or metadata: $(basename "$f")"
    ERRORS=$((ERRORS + 1))
  done
fi

for f in "$OUTPUT_DIR"/*.{exe,msi,dmg,deb,zip}; do
  [ -e "$f" ] || continue
  assert_evaos_beta_asset_identity "$(basename "$f")"
done

if [ "$INCLUDE_WEB_CLI_ASSETS" = "1" ]; then
  # Web-CLI tarballs + checksums
  if [ "$RELEASE_TARGET_PLATFORMS" = "macos" ]; then
    WEB_PLATFORMS=(darwin-arm64 darwin-x86_64)
  else
    WEB_PLATFORMS=(darwin-arm64 darwin-x86_64 linux-arm64 linux-x86_64 win-x86_64)
  fi

  for plat in "${WEB_PLATFORMS[@]}"; do
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
