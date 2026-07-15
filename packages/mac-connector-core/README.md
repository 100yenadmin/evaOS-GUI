# evaOS Mac connector core

This is the single reusable connector source boundary defined by [evaOS-GUI#699](https://github.com/100yenadmin/evaOS-GUI/issues/699).

PR #699 owns only the versioned contracts and cross-language JSON fixtures under `contracts/v1`, including the private non-Electron core host API. Moving the canonical Workbench Python source through PR #709 into the bounded `adapters`, `contracts`, `host`, `persistence`, and `policy` subpackages, adding native Swift ports, and integrating consumers belong to downstream child issues after their dependency gates are satisfied.

The archived `electricsheephq/evaos-desktop-bridge` repository is provenance only and must not be restored as source, build, or runtime truth.
