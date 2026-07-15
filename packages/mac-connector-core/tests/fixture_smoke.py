from __future__ import annotations

import json
from pathlib import Path


def main() -> None:
    root = Path(__file__).parent.parent / "contracts" / "v1"
    files = sorted(path for directory in (root / "fixtures", root / "golden") for path in directory.rglob("*.json"))
    if not files:
        raise SystemExit("no Mac Access contract fixtures or golden vectors found")
    for path in files:
        with path.open(encoding="utf-8") as handle:
            json.load(handle)
    print(f"parsed {len(files)} Mac Access contract fixture and golden-vector files")


if __name__ == "__main__":
    main()
