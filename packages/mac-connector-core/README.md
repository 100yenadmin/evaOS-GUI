# evaOS Mac connector core

This is the single reusable connector source boundary defined by [evaOS-GUI#699](https://github.com/100yenadmin/evaOS-GUI/issues/699).

The A1 core is owned by [evaOS-GUI#700](https://github.com/100yenadmin/evaOS-GUI/issues/700). Its canonical Python source lives under `python/evaos_desktop_bridge`, with the private non-Electron host boundary at `host/api.py`. Workbench generates its bundled `Bridge/src/evaos_desktop_bridge` payload from the explicit hash-pinned allowlist in `contracts/core-source-files.v1.json`; that generated tree is not a second source.

The host has exactly 14 operations and explicit injected state, pairing, runtime identity, credential, queue, clock, transport, authority, replay, audit-anchor, native action, and status ports. Runtime tests execute every one of the nine runtime-negative fixture IDs. The legacy Workbench HTTP/CLI compatibility modules remain quarantined under `host/` and `proof/`; `host/api.py` does not import them and is not a public listener.

`native/EvaOSEd25519Verify.swift` and `native/main.swift` build the pinned verifier used by the embedded runtime. The launcher at `native/evaos-desktop-bridge.sh` is also manifest-owned so historical release verification derives both launcher and verifier bytes from the exact release commit. Packaging launches only the absolute private `Bridge/python/bin/python3 -I -B`, clears ambient Python/virtualenv/pip/DYLD variables, and uses a fixed system path plus bundled tools. System Python, Homebrew, Electron, renderer code, Tailscale, and public inbound ports are not dependencies of the reusable core host.

The archived `electricsheephq/evaos-desktop-bridge` repository is provenance only and must not be restored as source, build, or runtime truth.
