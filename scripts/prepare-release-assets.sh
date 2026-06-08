#!/usr/bin/env bash
# prepare-release-assets.sh
#
# Normalize electron-updater metadata from multi-arch build artifacts
# into a deterministic release-assets/ directory.
#
# Usage:
#   ./scripts/prepare-release-assets.sh [ARTIFACTS_DIR] [OUTPUT_DIR]
#
# Defaults:
#   ARTIFACTS_DIR = build-artifacts
#   OUTPUT_DIR    = release-assets

set -euo pipefail

ARTIFACTS_DIR="${1:-build-artifacts}"
OUTPUT_DIR="${2:-release-assets}"
INCLUDE_WEB_CLI_ASSETS="${INCLUDE_WEB_CLI_ASSETS:-0}"
RELEASE_TARGET_PLATFORMS="${EVAOS_RELEASE_TARGET_PLATFORMS:-all}"

case "$RELEASE_TARGET_PLATFORMS" in
  all|macos)
    ;;
  *)
    echo "::error::Unsupported EVAOS_RELEASE_TARGET_PLATFORMS: $RELEASE_TARGET_PLATFORMS"
    echo "::error::Supported values: all, macos"
    exit 1
    ;;
esac

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "==> Release target platforms: $RELEASE_TARGET_PLATFORMS"

# ---------------------------------------------------------------------------
# 1) Copy all distributables (unique file names)
# ---------------------------------------------------------------------------
echo "==> Copying distributables from $ARTIFACTS_DIR ..."
DISTRIBUTABLES=()
if [ "$RELEASE_TARGET_PLATFORMS" = "macos" ]; then
  while IFS= read -r file; do
    DISTRIBUTABLES+=("$file")
  done < <(find "$ARTIFACTS_DIR" -type f \( \
    \( -path "*/macos-build-x64/*" -o -path "*/macos-build-arm64/*" \) -a \
    \( -name "*.dmg" -o -name "*.zip" \) \
  \) | sort)
else
  while IFS= read -r file; do
    DISTRIBUTABLES+=("$file")
  done < <(find "$ARTIFACTS_DIR" -type f \( \
    -name "*.exe" -o \
    -name "*.msi" -o \
    -name "*.dmg" -o \
    -name "*.deb" -o \
    -name "*.zip" \
  \) | sort)
fi

DUPLICATE_BASENAMES=$(for file in "${DISTRIBUTABLES[@]}"; do basename "$file"; done | sort | uniq -d || true)
if [ -n "$DUPLICATE_BASENAMES" ]; then
  echo "::error::Found duplicate distributable basenames that would be overwritten in flat output:"
  echo "$DUPLICATE_BASENAMES"
  exit 1
fi

for file in "${DISTRIBUTABLES[@]}"; do
  cp -f "$file" "$OUTPUT_DIR/"
done

if [ "$INCLUDE_WEB_CLI_ASSETS" = "1" ]; then
  # ---------------------------------------------------------------------------
  # 1b) Copy web-cli tarballs (+ sha256 checksums)
  # ---------------------------------------------------------------------------
  echo "==> Copying web-cli tarballs from $ARTIFACTS_DIR ..."
  WEB_CLI_FILES=()
  if [ "$RELEASE_TARGET_PLATFORMS" = "macos" ]; then
    while IFS= read -r file; do
      WEB_CLI_FILES+=("$file")
    done < <(find "$ARTIFACTS_DIR" -type f \( \
      \( -path "*/web-cli-darwin-arm64/*" -o -path "*/web-cli-darwin-x86_64/*" \) -a \
      \( -name "aionui-web-*.tar.gz" -o -name "aionui-web-*.tar.gz.sha256" \) \
    \) | sort)
  else
    while IFS= read -r file; do
      WEB_CLI_FILES+=("$file")
    done < <(find "$ARTIFACTS_DIR" -type f \( \
      -name "aionui-web-*.tar.gz" -o \
      -name "aionui-web-*.tar.gz.sha256" \
    \) | sort)
  fi

  WEB_CLI_DUPS=$(for file in "${WEB_CLI_FILES[@]}"; do basename "$file"; done | sort | uniq -d || true)
  if [ -n "$WEB_CLI_DUPS" ]; then
    echo "::error::Duplicate web-cli artifact basenames:"
    echo "$WEB_CLI_DUPS"
    exit 1
  fi

  for file in "${WEB_CLI_FILES[@]}"; do
    cp -f "$file" "$OUTPUT_DIR/"
  done

  # ---------------------------------------------------------------------------
  # 1c) Copy install-web.sh (version-substituted)
  # ---------------------------------------------------------------------------
  echo "==> Copying install-web.sh ..."
  INSTALL_SCRIPT=$(find "$ARTIFACTS_DIR" -type f -name 'install-web.sh' | head -n 1 || true)
  if [ -n "$INSTALL_SCRIPT" ]; then
    cp -f "$INSTALL_SCRIPT" "$OUTPUT_DIR/install-web.sh"
    chmod +x "$OUTPUT_DIR/install-web.sh"
  fi
else
  echo "==> Skipping web-cli tarballs and install-web.sh for beta release assets."
fi

# ---------------------------------------------------------------------------
# 2) Collect updater metadata from each platform artifact directory
# ---------------------------------------------------------------------------
echo "==> Collecting updater metadata ..."

WIN_X64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/windows-build-x64/*" -name "latest.yml" | sort | head -n 1 || true)
WIN_ARM64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/windows-build-arm64/*" -name "latest.yml" | sort | head -n 1 || true)
MAC_X64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/macos-build-x64/*" -name "latest-mac.yml" | sort | head -n 1 || true)
MAC_ARM64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/macos-build-arm64/*" -name "latest-mac.yml" | sort | head -n 1 || true)
LINUX_X64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/linux-build-x64/*" -name "latest-linux.yml" | sort | head -n 1 || true)
LINUX_ARM64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/linux-build-arm64/*" -name "latest-linux-arm64.yml" | sort | head -n 1 || true)

# ---------------------------------------------------------------------------
# 3) Publish deterministic canonical metadata for electron-updater
#    (avoid nondeterministic overwrite when multiple jobs produce same names)
# ---------------------------------------------------------------------------
echo "==> Writing canonical updater metadata ..."

[ -n "$MAC_X64_LATEST" ]    && cp -f "$MAC_X64_LATEST"    "$OUTPUT_DIR/latest-mac.yml"
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ]; then
  [ -n "$WIN_X64_LATEST" ]    && cp -f "$WIN_X64_LATEST"    "$OUTPUT_DIR/latest.yml"
  [ -n "$LINUX_X64_LATEST" ]  && cp -f "$LINUX_X64_LATEST"  "$OUTPUT_DIR/latest-linux.yml"
  [ -n "$LINUX_ARM64_LATEST" ] && cp -f "$LINUX_ARM64_LATEST" "$OUTPUT_DIR/latest-linux-arm64.yml"
fi

# ---------------------------------------------------------------------------
# 4) Architecture-specific metadata required by electron-updater
# ---------------------------------------------------------------------------
echo "==> Writing architecture-specific updater metadata ..."

if [ "$RELEASE_TARGET_PLATFORMS" = "all" ]; then
  [ -n "$WIN_ARM64_LATEST" ]  && cp -f "$WIN_ARM64_LATEST"  "$OUTPUT_DIR/latest-win-arm64.yml"
fi

# electron-updater on macOS constructs the yml filename as "${channel}-mac.yml".
# For arm64, channel is "latest-arm64", so it looks for "latest-arm64-mac.yml".
[ -n "$MAC_ARM64_LATEST" ]  && cp -f "$MAC_ARM64_LATEST"  "$OUTPUT_DIR/latest-arm64-mac.yml"

# ---------------------------------------------------------------------------
# 5) Hard validation for required updater metadata
# ---------------------------------------------------------------------------
echo "==> Validating required metadata ..."

MISSING=0

assert_evaos_beta_asset_identity() {
  local base="$1"

  case "$base" in
    *"AionUi"*|*"AionUI"*|*"Aion-UI"*|*"aion-ui"*|*"aionui"*)
      echo "::error::Refusing upstream-branded beta asset: $base"
      exit 1
      ;;
  esac

  case "$base" in
    *"evaOS Workbench Beta"*|*"EvaOSWorkbenchBeta"*|*"evaos-workbench-beta"*)
      ;;
    *)
      echo "::error::Refusing beta asset without evaOS beta identity marker: $base"
      exit 1
      ;;
  esac
}

REQUIRED_METADATA=(latest-mac.yml)
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ]; then
  REQUIRED_METADATA=(latest.yml latest-mac.yml latest-linux.yml latest-linux-arm64.yml)
fi

for required in "${REQUIRED_METADATA[@]}"; do
  if [ ! -f "$OUTPUT_DIR/$required" ]; then
    echo "::error::Missing required updater metadata: $required"
    MISSING=1
  fi
done

for file in "$OUTPUT_DIR"/*.{exe,msi,dmg,deb,zip}; do
  [ -e "$file" ] || continue
  assert_evaos_beta_asset_identity "$(basename "$file")"
done

if [ "$INCLUDE_WEB_CLI_ASSETS" = "1" ]; then
  # ---------------------------------------------------------------------------
  # 5b) Hard validation for web-cli release assets
  # ---------------------------------------------------------------------------
  echo "==> Validating web-cli assets ..."

  VERSION="${MOCK_VERSION:-$(node -p "require('./package.json').version")}"
  if [ "$RELEASE_TARGET_PLATFORMS" = "macos" ]; then
    WEB_PLATFORMS=(
      "darwin-arm64"
      "darwin-x86_64"
    )
  else
    WEB_PLATFORMS=(
      "darwin-arm64"
      "darwin-x86_64"
      "linux-arm64"
      "linux-x86_64"
      "win-x86_64"
    )
  fi

  for plat in "${WEB_PLATFORMS[@]}"; do
    tarball="aionui-web-${VERSION}-${plat}.tar.gz"
    if [ ! -f "$OUTPUT_DIR/$tarball" ]; then
      echo "::error::Missing web-cli tarball: $tarball"
      MISSING=1
    fi
    if [ ! -f "$OUTPUT_DIR/${tarball}.sha256" ]; then
      echo "::error::Missing web-cli checksum: ${tarball}.sha256"
      MISSING=1
    fi
  done

  if [ ! -f "$OUTPUT_DIR/install-web.sh" ]; then
    echo "::error::Missing install-web.sh"
    MISSING=1
  fi
fi

if [ "$MISSING" -ne 0 ]; then
  exit 1
fi

echo ""
echo "==> Prepared release assets:"
ls -lh "$OUTPUT_DIR"
echo ""
echo "==> Done."
