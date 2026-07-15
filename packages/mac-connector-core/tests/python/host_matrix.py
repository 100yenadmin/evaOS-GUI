from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

TEST_ROOT = Path(__file__).resolve().parent
CORE_ROOT = TEST_ROOT.parents[1]
sys.path.insert(0, str(CORE_ROOT / "python"))
sys.path.insert(0, str(TEST_ROOT))

from test_host_api import BINDING, CoreHostTests, broker_envelope, request  # noqa: E402


def exchange(host: CoreHostTests, payload: dict[str, Any]) -> dict[str, Any]:
    return {"request": payload, "response": host.host.handle(payload)}


def main() -> None:
    primary = CoreHostTests(methodName="runTest")
    primary.setUp()
    exchanges = [exchange(primary, request("status", 1, None))]
    pair_request = request(
        "pair",
        2,
        0,
        pairing_code="ABC123",
        local_installation_nonce="A" * 43,
    )
    exchanges.append(exchange(primary, pair_request))
    exchanges.append(exchange(primary, request("connect", 3, 1, binding=BINDING)))
    exchanges.append(
        exchange(primary, request("set_access_mode", 4, 1, target_mode="ask_every_time"))
    )
    exchanges.append(
        exchange(primary, request("dispatch_action", 5, 2, envelope=broker_envelope(2)))
    )
    exchanges.append(
        exchange(primary, request("audit_summary", 6, 2, after_cursor=None, limit=10))
    )
    exchanges.append(exchange(primary, request("pause", 7, 2)))
    exchanges.append(exchange(primary, request("resume", 8, 3)))
    exchanges.append(exchange(primary, request("disconnect", 9, 4)))
    exchanges.append(exchange(primary, request("stop", 10, 4)))
    exchanges.append(exchange(primary, request("unpair", 11, 5)))

    for operation in ("revoke", "activate_kill_switch"):
        isolated = CoreHostTests(methodName="runTest")
        isolated.setUp()
        isolated.pair()
        exchanges.append(exchange(isolated, request(operation, 2, 1)))

    expired = CoreHostTests(methodName="runTest")
    expired.setUp()
    expired.pair()
    exchange(expired, request("connect", 2, 1, binding=BINDING))
    exchange(expired, request("set_access_mode", 3, 1, target_mode="ask_every_time"))
    expired.clock.rejection = "grant_expired"
    exchanges.append(
        exchange(expired, request("dispatch_action", 4, 2, envelope=broker_envelope(2)))
    )

    shutdown = CoreHostTests(methodName="runTest")
    shutdown.setUp()
    exchanges.append(exchange(shutdown, request("shutdown", 1, 0)))
    print(json.dumps(exchanges, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
