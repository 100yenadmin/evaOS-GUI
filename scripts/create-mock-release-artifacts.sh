#!/usr/bin/env bash

set -euo pipefail

ARTIFACTS_DIR="${1:-build-artifacts}"
VERSION="${MOCK_VERSION:-1.0.0}"
PRODUCT_NAME="${MOCK_PRODUCT_NAME:-evaOS Workbench Beta}"
RELEASE_TARGET_PLATFORMS="${EVAOS_RELEASE_TARGET_PLATFORMS:-all}"
MOCK_MACOS_DMG_ONLY="${EVAOS_MOCK_MACOS_DMG_ONLY:-0}"

case "$RELEASE_TARGET_PLATFORMS" in
  all|macos)
    ;;
  *)
    echo "Unsupported EVAOS_RELEASE_TARGET_PLATFORMS: $RELEASE_TARGET_PLATFORMS" >&2
    echo "Supported values: all, macos" >&2
    exit 1
    ;;
esac

rm -rf "$ARTIFACTS_DIR"
mkdir -p "$ARTIFACTS_DIR/macos-build-x64"
mkdir -p "$ARTIFACTS_DIR/macos-build-arm64"
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ]; then
  mkdir -p "$ARTIFACTS_DIR/windows-build-x64"
  mkdir -p "$ARTIFACTS_DIR/windows-build-arm64"
  mkdir -p "$ARTIFACTS_DIR/linux-build-x64"
  mkdir -p "$ARTIFACTS_DIR/linux-build-arm64"
fi

# Windows x64
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ]; then
  touch "$ARTIFACTS_DIR/windows-build-x64/${PRODUCT_NAME}-${VERSION}-win-x64.exe"
  cat > "$ARTIFACTS_DIR/windows-build-x64/latest.yml" <<EOF
version: ${VERSION}
files:
  - url: ${PRODUCT_NAME}-${VERSION}-win-x64.exe
    sha512: fake-sha512-x64
    size: 100000
path: ${PRODUCT_NAME}-${VERSION}-win-x64.exe
sha512: fake-sha512-x64
releaseDate: '2025-01-01'
EOF
fi

# Windows arm64
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ]; then
  touch "$ARTIFACTS_DIR/windows-build-arm64/${PRODUCT_NAME}-${VERSION}-win-arm64.exe"
  cat > "$ARTIFACTS_DIR/windows-build-arm64/latest.yml" <<EOF
version: ${VERSION}
files:
  - url: ${PRODUCT_NAME}-${VERSION}-win-arm64.exe
    sha512: fake-sha512-arm64
    size: 100000
path: ${PRODUCT_NAME}-${VERSION}-win-arm64.exe
sha512: fake-sha512-arm64
releaseDate: '2025-01-01'
EOF
fi

# macOS x64
touch "$ARTIFACTS_DIR/macos-build-x64/${PRODUCT_NAME}-${VERSION}-mac-x64.dmg"
if [ "$MOCK_MACOS_DMG_ONLY" != "1" ]; then
  touch "$ARTIFACTS_DIR/macos-build-x64/${PRODUCT_NAME}-${VERSION}-mac-x64.zip"
  cat > "$ARTIFACTS_DIR/macos-build-x64/latest-mac.yml" <<EOF
version: ${VERSION}
files:
  - url: ${PRODUCT_NAME}-${VERSION}-mac-x64.dmg
    sha512: fake-sha512-mac-x64
    size: 200000
EOF
fi

# macOS arm64
touch "$ARTIFACTS_DIR/macos-build-arm64/${PRODUCT_NAME}-${VERSION}-mac-arm64.dmg"
if [ "$MOCK_MACOS_DMG_ONLY" != "1" ]; then
  touch "$ARTIFACTS_DIR/macos-build-arm64/${PRODUCT_NAME}-${VERSION}-mac-arm64.zip"
  cat > "$ARTIFACTS_DIR/macos-build-arm64/latest-mac.yml" <<EOF
version: ${VERSION}
files:
  - url: ${PRODUCT_NAME}-${VERSION}-mac-arm64.dmg
    sha512: fake-sha512-mac-arm64
    size: 200000
EOF
fi

# Linux x64
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ]; then
  touch "$ARTIFACTS_DIR/linux-build-x64/${PRODUCT_NAME}-${VERSION}-linux-x64.deb"
  cat > "$ARTIFACTS_DIR/linux-build-x64/latest-linux.yml" <<EOF
version: ${VERSION}
files:
  - url: ${PRODUCT_NAME}-${VERSION}-linux-x64.deb
    sha512: fake-sha512-linux
    size: 300000
EOF
fi

# Linux arm64
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ]; then
  touch "$ARTIFACTS_DIR/linux-build-arm64/${PRODUCT_NAME}-${VERSION}-linux-arm64.deb"
  cat > "$ARTIFACTS_DIR/linux-build-arm64/latest-linux-arm64.yml" <<EOF
version: ${VERSION}
files:
  - url: ${PRODUCT_NAME}-${VERSION}-linux-arm64.deb
    sha512: fake-sha512-linux-arm64
    size: 300000
EOF
fi

# Web-CLI tarballs (5 platforms)
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
  dir="$ARTIFACTS_DIR/web-cli-${plat}"
  mkdir -p "$dir"
  tarball="aionui-web-${VERSION}-${plat}.tar.gz"
  touch "$dir/$tarball"
  # Produce a deterministic fake SHA256 file in the expected format:
  # "<64 hex chars>  <filename>"
  echo "0000000000000000000000000000000000000000000000000000000000000000  ${tarball}" > "$dir/${tarball}.sha256"
done

# install-web.sh (version-substituted placeholder)
mkdir -p "$ARTIFACTS_DIR/install-web-script"
cat > "$ARTIFACTS_DIR/install-web-script/install-web.sh" <<'EOF'
#!/usr/bin/env bash
# Mock install-web.sh for release-script-test
set -euo pipefail
echo "mock install-web.sh"
EOF
chmod +x "$ARTIFACTS_DIR/install-web-script/install-web.sh"

echo "Mock artifacts created in $ARTIFACTS_DIR for $RELEASE_TARGET_PLATFORMS:"
find "$ARTIFACTS_DIR" -type f | sort
