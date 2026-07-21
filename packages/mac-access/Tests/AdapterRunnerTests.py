import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


RUNNER_PATH = Path(__file__).parents[1] / "Runtime" / "mac_access_adapter_runner.py"
SPEC = importlib.util.spec_from_file_location("mac_access_adapter_runner", RUNNER_PATH)
RUNNER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(RUNNER)


class AdapterRunnerTests(unittest.TestCase):
    def test_integer_click_coordinates_remain_absolute(self):
        method, arguments = RUNNER.normalized_call(
            "customer_mac.desktop_click", {"x": 120, "y": 45}
        )
        self.assertEqual(method, "desktop_click")
        self.assertEqual((arguments["x"], arguments["y"]), (120, 45))

    def test_normalized_click_coordinates_use_main_display(self):
        quartz = types.SimpleNamespace(
            CGMainDisplayID=lambda: 7,
            CGDisplayBounds=lambda _display: types.SimpleNamespace(
                origin=types.SimpleNamespace(x=0, y=0),
                size=types.SimpleNamespace(width=1920, height=1080),
            ),
        )
        with patch.dict(sys.modules, {"Quartz": quartz}):
            _, arguments = RUNNER.normalized_call(
                "customer_mac.desktop_click", {"x": 0.72, "y": 0.05}
            )
        self.assertEqual((arguments["x"], arguments["y"]), (1382, 54))

    def test_normalized_click_coordinates_reject_out_of_range(self):
        with self.assertRaisesRegex(RUNNER.RequestError, "x_invalid"):
            RUNNER.normalized_call(
                "customer_mac.desktop_click", {"x": 1.1, "y": 0.5}
            )

    def test_runtime_error_code_reports_only_exception_class(self):
        error = PermissionError("/private/path/that/must/not-leak")
        self.assertEqual(
            RUNNER._runtime_error_code(error),
            "adapter_runtime_permissionerror",
        )
        self.assertNotIn("private", RUNNER._runtime_error_code(error))

    def test_see_result_compacts_fallback_metadata_for_relay(self):
        compact = RUNNER._wire_safe_see_data(
            {
                "engine": "fallback",
                "frontmost_app": "TextEdit",
                "snapshot_id": "snap-1",
                "screenshot": {"bytes": "x" * 100_000},
                "ax": {"nodes": [{"private": "x" * 100_000}]},
                "elements": [
                    {
                        "element_id": "el-1",
                        "snapshot_id": "snap-1",
                        "label": "Editor",
                        "role": "AXTextArea",
                        "bounds": {"x": 20, "y": 40, "width": 600, "height": 400},
                        "center": {"x": 320, "y": 240},
                        "actions": ["click"],
                        "engine": "ax_fallback",
                        "ax_target": {"path": ["x" * 100_000]},
                    }
                ],
            }
        )
        self.assertEqual(compact["engine"], "fallback")
        self.assertEqual(compact["elements"][0]["element_id"], "el-1")
        self.assertEqual(compact["elements"][0]["center"], {"x": 320, "y": 240})
        self.assertNotIn("screenshot", compact)
        self.assertNotIn("ax", compact)
        self.assertNotIn("ax_target", compact["elements"][0])
        self.assertLessEqual(
            len(json.dumps(compact, separators=(",", ":")).encode()),
            RUNNER.MAX_WIRE_SEE_RESULT_BYTES,
        )

    def test_see_result_truncates_elements_at_wire_boundary(self):
        compact = RUNNER._wire_safe_see_data(
            {
                "engine": "fallback",
                "snapshot_id": "snap-2",
                "elements": [
                    {
                        "element_id": f"el-{index}",
                        "snapshot_id": "snap-2",
                        "label": "x" * 500,
                        "role": "AXButton",
                        "bounds": {"x": index, "y": 1, "width": 20, "height": 20},
                        "center": {"x": index + 10, "y": 11},
                        "actions": ["click"],
                        "engine": "ax_fallback",
                    }
                    for index in range(200)
                ],
            }
        )
        self.assertTrue(compact["wire_truncated"])
        self.assertLess(len(compact["elements"]), 200)
        self.assertLessEqual(
            len(json.dumps(compact, separators=(",", ":")).encode()),
            RUNNER.MAX_WIRE_SEE_RESULT_BYTES,
        )

    def test_see_result_rejects_screenshot_only_observation(self):
        self.assertIsNone(
            RUNNER._wire_safe_see_data(
                {
                    "engine": "fallback",
                    "snapshot_id": "snap-screenshot-only",
                    "screenshot": {"artifact_path": "~/private-local-artifact.png"},
                    "elements": [],
                }
            )
        )


if __name__ == "__main__":
    unittest.main()
