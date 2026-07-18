import importlib.util
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


if __name__ == "__main__":
    unittest.main()
