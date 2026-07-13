#!/usr/bin/env bash

set -euo pipefail

ARTIFACTS_DIR="${1:-build-artifacts}"
VERSION="${MOCK_VERSION:-1.0.0}"
PRODUCT_NAME="${MOCK_PRODUCT_NAME:-evaOS Workbench}"
RELEASE_TARGET_PLATFORMS="${EVAOS_RELEASE_TARGET_PLATFORMS:-all}"
MOCK_MACOS_DMG_ONLY="${EVAOS_MOCK_MACOS_DMG_ONLY:-0}"

case "$RELEASE_TARGET_PLATFORMS" in
  all|macos|macos-arm64|windows)
    ;;
  *)
    echo "Unsupported EVAOS_RELEASE_TARGET_PLATFORMS: $RELEASE_TARGET_PLATFORMS" >&2
    echo "Supported values: all, macos, macos-arm64, windows" >&2
    exit 1
    ;;
esac

rm -rf "$ARTIFACTS_DIR"
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ] || [ "$RELEASE_TARGET_PLATFORMS" = "macos" ]; then
  mkdir -p "$ARTIFACTS_DIR/macos-build-x64"
fi
if [ "$RELEASE_TARGET_PLATFORMS" != "windows" ]; then
  mkdir -p "$ARTIFACTS_DIR/macos-build-arm64"
fi
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ] || [ "$RELEASE_TARGET_PLATFORMS" = "windows" ]; then
  mkdir -p "$ARTIFACTS_DIR/windows-build-x64"
  mkdir -p "$ARTIFACTS_DIR/windows-build-arm64"
fi
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ]; then
  mkdir -p "$ARTIFACTS_DIR/linux-build-x64"
  mkdir -p "$ARTIFACTS_DIR/linux-build-arm64"
fi

create_mock_macos_zip() {
  local output_path="$1"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  mkdir -p "$tmp_dir/${PRODUCT_NAME}.app/Contents/Resources/Bridge/bin"
  mkdir -p "$tmp_dir/${PRODUCT_NAME}.app/Contents/Resources/Bridge/licenses"
  printf '#!/usr/bin/env bash\nprintf "{}\\n"\n' > "$tmp_dir/${PRODUCT_NAME}.app/Contents/Resources/Bridge/evaos-desktop-bridge"
  chmod +x "$tmp_dir/${PRODUCT_NAME}.app/Contents/Resources/Bridge/evaos-desktop-bridge"
  python3 - "$tmp_dir/${PRODUCT_NAME}.app/Contents/Resources/Bridge" "$output_path" "tests/fixtures/licenses/CPython-3.12.13-LICENSE.txt" <<'PY'
import hashlib
import json
import pathlib
import stat
import sys

bridge = pathlib.Path(sys.argv[1])
output_path = pathlib.Path(sys.argv[2])
python_license_path = pathlib.Path(sys.argv[3])
architecture = "arm64" if "arm64" in output_path.name else "x64"
runtime_sha256 = (
    "5a30271f8d345a5b02b0c9e4e31e0f1e1455a8e4a04fba95cd9762472abc3b17"
    if architecture == "arm64"
    else "cd369e76973c3179bc578230d8615ab621968ed758c5e32f636eecef4ad79894"
)
runtime_arch = "aarch64" if architecture == "arm64" else "x86_64"
python_header = bytes.fromhex("cffaedfe0c000001" if architecture == "arm64" else "cffaedfe07000001")
macho = bytes.fromhex("cafebabe00000000")
license_bytes = b"MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n"
python_license_bytes = python_license_path.read_bytes()
(bridge / "bin" / "peekaboo").write_bytes(macho)
(bridge / "bin" / "evaos-connector-helper").write_bytes(macho)
(bridge / "bin" / "peekaboo").chmod(0o755)
(bridge / "bin" / "evaos-connector-helper").chmod(0o755)
(bridge / "licenses" / "Peekaboo-LICENSE.txt").write_bytes(license_bytes)
(bridge / "licenses" / "CPython-LICENSE.txt").write_bytes(python_license_bytes)
python_bin = bridge / "python" / "bin"
site_packages = bridge / "python" / "lib" / "python3.12" / "site-packages"
python_bin.mkdir(parents=True)
(python_bin / "python3.12").write_bytes(python_header)
(python_bin / "python3.12").chmod(0o755)
(python_bin / "python3").symlink_to("python3.12")
for package in ("ApplicationServices", "Cocoa", "CoreText", "Quartz", "objc"):
    package_dir = site_packages / package
    package_dir.mkdir(parents=True, exist_ok=True)
    (package_dir / "__init__.py").write_text("", encoding="utf-8")
(bridge / "python" / "lib" / "python3.12" / "LICENSE.txt").write_bytes(python_license_bytes)
encodings_dir = bridge / "python" / "lib" / "python3.12" / "encodings"
encodings_dir.mkdir(parents=True, exist_ok=True)
(encodings_dir / "__init__.py").write_text("# encodings fixture\n", encoding="utf-8")
native_paths = [
    site_packages / "objc" / "_objc.cpython-312-darwin.so",
    site_packages / "Foundation" / "_Foundation.cpython-312-darwin.so",
    site_packages / "Quartz" / "CoreGraphics" / "_coregraphics.cpython-312-darwin.so",
    site_packages / "HIServices" / "_HIServices.cpython-312-darwin.so",
    site_packages / "CoreText" / "_manual.cpython-312-darwin.so",
]
for native_path in native_paths:
    native_path.parent.mkdir(parents=True, exist_ok=True)
    native_path.write_bytes(python_header)
    native_path.chmod(0o755)
(site_packages / "runtime-only.py").write_text("runtime closure\n", encoding="utf-8")
runtime_root = bridge / "python"
inventory_entries = []
for runtime_path in sorted(runtime_root.rglob("*")):
    relative_path = runtime_path.relative_to(runtime_root).as_posix()
    metadata = runtime_path.lstat()
    if runtime_path.is_symlink():
        inventory_entries.append({
            "path": relative_path,
            "type": "symlink",
            "mode": 0o777,
            "target": runtime_path.readlink().as_posix(),
        })
    elif runtime_path.is_dir():
        inventory_entries.append({
            "path": relative_path,
            "type": "directory",
            "mode": stat.S_IMODE(metadata.st_mode),
        })
    elif runtime_path.is_file():
        contents = runtime_path.read_bytes()
        inventory_entries.append({
            "path": relative_path,
            "type": "file",
            "mode": stat.S_IMODE(metadata.st_mode),
            "size": len(contents),
            "sha256": hashlib.sha256(contents).hexdigest(),
            **({"signedMachO": True} if contents[:4].hex() in {"feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "cafebabf", "bebafeca", "bfbafeca"} else {}),
        })
inventory = {"schema": "evaos-python-runtime-inventory/v1", "entries": inventory_entries}
inventory_bytes = (json.dumps(inventory, indent=2) + "\n").encode()
(bridge / "python-runtime-inventory.json").write_bytes(inventory_bytes)
python_packages = [
    {"name":"pyobjc-core","version":"12.2.1","sha256":"a64232bb27ed101d4adc7d42b0e64a6d3331aac7bee7861c037a6777a163f10b"},
    {"name":"pyobjc-framework-Cocoa","version":"12.2.1","sha256":"28b9b8bab1c36efb94744786918752d0c1842f5fbb67e7d5ca97b5f736512080"},
    {"name":"pyobjc-framework-Quartz","version":"12.2.1","sha256":"de9c8cca7e95290c8d540466af11c7cdfe3a5458e6f56c34006d5b45243f9ed9"},
    {"name":"pyobjc-framework-ApplicationServices","version":"12.2.1","sha256":"f519ced13888d03410cd7da1f08fc56ee2944099e607216cef7ca26ecfdef61b"},
    {"name":"pyobjc-framework-CoreText","version":"12.2.1","sha256":"ac2ead13dfa4379a1566129d0e8a8ea778a2bcac9ac360a583360fd4f1ba39c6"},
]
manifest = {
    "placeholder": False,
    "source": "mock-release-asset",
    "bundledTools": {
        "peekaboo": {
            "version": "3.8.0",
            "sourceSha256": "4a5c7e28c263c84e406aa1853ef62cad3042b13f40a7a9e044ec74ec42933383",
            "license": "MIT",
            "licensePath": "licenses/Peekaboo-LICENSE.txt",
            "licenseSha256": hashlib.sha256(license_bytes).hexdigest(),
        },
        "python": {
            "version": "3.12.13",
            "architecture": architecture,
            "sourceSha256": runtime_sha256,
            "sourceUrl": f"https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython-3.12.13+20260510-{runtime_arch}-apple-darwin-install_only.tar.gz",
            "packages": python_packages,
            "license": "Python-2.0",
            "licensePath": "licenses/CPython-LICENSE.txt",
            "licenseSha256": hashlib.sha256(python_license_bytes).hexdigest(),
            "inventoryPath": "python-runtime-inventory.json",
            "inventorySha256": hashlib.sha256(inventory_bytes).hexdigest(),
            "inventoryEntryCount": len(inventory_entries),
        },
    },
}
(bridge / "manifest.json").write_text(json.dumps(manifest) + "\n", encoding="utf-8")
PY
  python3 - "$tmp_dir" "$output_path" <<'PY'
import pathlib
import stat
import sys
import zipfile

root = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if path.is_symlink():
            info = zipfile.ZipInfo(str(relative))
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.readlink().as_posix())
        else:
            archive.write(path, relative)
PY
  rm -rf "$tmp_dir"
}

# Windows x64
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ] || [ "$RELEASE_TARGET_PLATFORMS" = "windows" ]; then
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
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ] || [ "$RELEASE_TARGET_PLATFORMS" = "windows" ]; then
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
if [ "$RELEASE_TARGET_PLATFORMS" = "all" ] || [ "$RELEASE_TARGET_PLATFORMS" = "macos" ]; then
  touch "$ARTIFACTS_DIR/macos-build-x64/${PRODUCT_NAME}-${VERSION}-mac-x64.dmg"
  if [ "$MOCK_MACOS_DMG_ONLY" != "1" ]; then
    create_mock_macos_zip "$ARTIFACTS_DIR/macos-build-x64/${PRODUCT_NAME}-${VERSION}-mac-x64.zip"
    cat > "$ARTIFACTS_DIR/macos-build-x64/latest-mac.yml" <<EOF
version: ${VERSION}
files:
  - url: ${PRODUCT_NAME}-${VERSION}-mac-x64.dmg
    sha512: fake-sha512-mac-x64
    size: 200000
EOF
  fi
fi

# macOS arm64
if [ "$RELEASE_TARGET_PLATFORMS" != "windows" ]; then
  touch "$ARTIFACTS_DIR/macos-build-arm64/${PRODUCT_NAME}-${VERSION}-mac-arm64.dmg"
  if [ "$MOCK_MACOS_DMG_ONLY" != "1" ]; then
    create_mock_macos_zip "$ARTIFACTS_DIR/macos-build-arm64/${PRODUCT_NAME}-${VERSION}-mac-arm64.zip"
    cat > "$ARTIFACTS_DIR/macos-build-arm64/latest-mac.yml" <<EOF
version: ${VERSION}
files:
  - url: ${PRODUCT_NAME}-${VERSION}-mac-arm64.dmg
    sha512: fake-sha512-mac-arm64
    size: 200000
EOF
  fi
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

# Web-CLI tarballs (profile-dependent)
case "$RELEASE_TARGET_PLATFORMS" in
  macos)
    WEB_PLATFORMS=(
      "darwin-arm64"
      "darwin-x86_64"
    )
    ;;
  macos-arm64)
    WEB_PLATFORMS=(
      "darwin-arm64"
    )
    ;;
  windows)
    WEB_PLATFORMS=(
      "win-x86_64"
    )
    ;;
  all)
    WEB_PLATFORMS=(
      "darwin-arm64"
      "darwin-x86_64"
      "linux-arm64"
      "linux-x86_64"
      "win-x86_64"
    )
    ;;
esac

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
