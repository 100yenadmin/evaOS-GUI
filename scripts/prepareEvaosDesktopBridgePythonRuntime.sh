#!/usr/bin/env bash
set -euo pipefail

target_arch="${1:?target architecture is required (arm64 or x64)}"
env_output="${2:-${GITHUB_ENV:-}}"
if [ -z "$env_output" ]; then
  echo "No environment output file was provided." >&2
  exit 2
fi

: "${PYTHON_RUNTIME_VERSION:=3.12.13}"
: "${PYTHON_RUNTIME_RELEASE:=20260510}"
: "${PYTHON_RUNTIME_ARM64_SHA256:=5a30271f8d345a5b02b0c9e4e31e0f1e1455a8e4a04fba95cd9762472abc3b17}"
: "${PYTHON_RUNTIME_X64_SHA256:=cd369e76973c3179bc578230d8615ab621968ed758c5e32f636eecef4ad79894}"
: "${RUNNER_TEMP:=${TMPDIR:-/tmp}}"

case "$target_arch" in
  arm64)
    runtime_arch="aarch64"
    expected_lipo_arch="arm64"
    runtime_sha256="$PYTHON_RUNTIME_ARM64_SHA256"
    ;;
  x64)
    runtime_arch="x86_64"
    expected_lipo_arch="x86_64"
    runtime_sha256="$PYTHON_RUNTIME_X64_SHA256"
    ;;
  *)
    echo "No pinned desktop bridge Python runtime for architecture $target_arch." >&2
    exit 1
    ;;
esac

runtime_asset="cpython-${PYTHON_RUNTIME_VERSION}+${PYTHON_RUNTIME_RELEASE}-${runtime_arch}-apple-darwin-install_only.tar.gz"
runtime_url="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RUNTIME_RELEASE}/${runtime_asset}"
runtime_archive="${RUNNER_TEMP:?RUNNER_TEMP is required}/${runtime_asset}"
runtime_root="${RUNNER_TEMP}/evaos-python-${PYTHON_RUNTIME_VERSION}-${runtime_arch}"
wheelhouse="${RUNNER_TEMP}/evaos-python-wheelhouse-${PYTHON_RUNTIME_VERSION}"

curl --fail --location --retry 3 --output "$runtime_archive" "$runtime_url"
printf '%s  %s\n' "$runtime_sha256" "$runtime_archive" | shasum -a 256 -c -
rm -rf "$runtime_root" "$wheelhouse"
mkdir -p "$runtime_root" "$wheelhouse"
tar -xzf "$runtime_archive" -C "$runtime_root"
runtime_dir="$runtime_root/python"
test -x "$runtime_dir/bin/python3"
test -f "$runtime_dir/lib/python3.12/LICENSE.txt"
test "$("$runtime_dir/bin/python3" --version)" = "Python ${PYTHON_RUNTIME_VERSION}"
test "$(lipo -archs "$runtime_dir/bin/python3.12")" = "$expected_lipo_arch"

pyobjc_wheels=(
  'pyobjc_core-12.2.1-cp312-cp312-macosx_10_13_universal2.whl|a64232bb27ed101d4adc7d42b0e64a6d3331aac7bee7861c037a6777a163f10b|https://files.pythonhosted.org/packages/8c/88/300ad283bed0c971c52dcac6f70113e138169d4ce6d856ddd03d16081e51/pyobjc_core-12.2.1-cp312-cp312-macosx_10_13_universal2.whl'
  'pyobjc_framework_cocoa-12.2.1-cp312-cp312-macosx_10_13_universal2.whl|28b9b8bab1c36efb94744786918752d0c1842f5fbb67e7d5ca97b5f736512080|https://files.pythonhosted.org/packages/f7/cf/1b3b32b2f28f66cc053c3438ef4e6df36a1591945bf05e7399da18d74553/pyobjc_framework_cocoa-12.2.1-cp312-cp312-macosx_10_13_universal2.whl'
  'pyobjc_framework_quartz-12.2.1-cp312-cp312-macosx_10_13_universal2.whl|de9c8cca7e95290c8d540466af11c7cdfe3a5458e6f56c34006d5b45243f9ed9|https://files.pythonhosted.org/packages/14/fc/d7c7b3134cdbd1a487f3f77b5be125d87a6c9e7d9411035739d99335cc0c/pyobjc_framework_quartz-12.2.1-cp312-cp312-macosx_10_13_universal2.whl'
  'pyobjc_framework_applicationservices-12.2.1-cp312-cp312-macosx_10_13_universal2.whl|f519ced13888d03410cd7da1f08fc56ee2944099e607216cef7ca26ecfdef61b|https://files.pythonhosted.org/packages/bf/89/39a7462006afbc06c69029fe4181b7359a9da25ae7864ef75f9d3ffb9272/pyobjc_framework_applicationservices-12.2.1-cp312-cp312-macosx_10_13_universal2.whl'
  'pyobjc_framework_coretext-12.2.1-cp312-cp312-macosx_10_13_universal2.whl|ac2ead13dfa4379a1566129d0e8a8ea778a2bcac9ac360a583360fd4f1ba39c6|https://files.pythonhosted.org/packages/c5/11/c1298c2ec3b0cd19a457a1fd0da47898f894a13df5516f80dc04d1a7a4d9/pyobjc_framework_coretext-12.2.1-cp312-cp312-macosx_10_13_universal2.whl'
)

for wheel_spec in "${pyobjc_wheels[@]}"; do
  IFS='|' read -r wheel_name wheel_sha256 wheel_url <<< "$wheel_spec"
  wheel_path="$wheelhouse/$wheel_name"
  curl --fail --location --retry 3 --output "$wheel_path" "$wheel_url"
  printf '%s  %s\n' "$wheel_sha256" "$wheel_path" | shasum -a 256 -c -
done

"$runtime_dir/bin/python3" -m pip install \
  --disable-pip-version-check \
  --no-compile \
  --no-deps \
  --no-index \
  --target "$runtime_dir/lib/python3.12/site-packages" \
  "$wheelhouse"/*.whl
"$runtime_dir/bin/python3" -I -c 'import ApplicationServices, Quartz; print("bundled-pyobjc-ok")'

packages_json='[{"name":"pyobjc-core","version":"12.2.1","sha256":"a64232bb27ed101d4adc7d42b0e64a6d3331aac7bee7861c037a6777a163f10b"},{"name":"pyobjc-framework-Cocoa","version":"12.2.1","sha256":"28b9b8bab1c36efb94744786918752d0c1842f5fbb67e7d5ca97b5f736512080"},{"name":"pyobjc-framework-Quartz","version":"12.2.1","sha256":"de9c8cca7e95290c8d540466af11c7cdfe3a5458e6f56c34006d5b45243f9ed9"},{"name":"pyobjc-framework-ApplicationServices","version":"12.2.1","sha256":"f519ced13888d03410cd7da1f08fc56ee2944099e607216cef7ca26ecfdef61b"},{"name":"pyobjc-framework-CoreText","version":"12.2.1","sha256":"ac2ead13dfa4379a1566129d0e8a8ea778a2bcac9ac360a583360fd4f1ba39c6"}]'
{
  echo "EVAOS_DESKTOP_BRIDGE_PYTHON_RUNTIME_DIR=$runtime_dir"
  echo "EVAOS_REQUIRED_PYTHON_RUNTIME_VERSION=$PYTHON_RUNTIME_VERSION"
  echo "EVAOS_REQUIRED_PYTHON_RUNTIME_SHA256=$runtime_sha256"
  echo "EVAOS_REQUIRED_PYTHON_RUNTIME_SOURCE_URL=$runtime_url"
  echo "EVAOS_REQUIRED_PYTHON_RUNTIME_ARCH=$target_arch"
  echo "EVAOS_REQUIRED_PYTHON_RUNTIME_PACKAGES_JSON=$packages_json"
} >> "$env_output"
