from __future__ import annotations

import json
from pathlib import Path


def main() -> None:
    root = Path(__file__).parent.parent / "contracts" / "v1" / "fixtures"
    files = sorted(root.rglob("*.json"))
    if not files:
        raise SystemExit("no Mac Access contract fixtures found")
    for path in files:
        with path.open(encoding="utf-8") as handle:
            json.load(handle)
    print(f"parsed {len(files)} Mac Access contract fixture files")


if __name__ == "__main__":
    main()
