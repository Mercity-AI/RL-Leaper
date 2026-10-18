"""Pin the frozen brain recipe so lab changes can never alter the shipped Leaper."""
import hashlib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FROZEN = ROOT / "rl" / "frozen_7757824"

# SHA256 of each frozen file. rl_environment.py equals rl_environment.py at 7689aca.
PINNED = {
    "rl_environment.py": "f9f1af20c9fb5d820b565b05e80464a015dfe57aa272572c851a5fb41dc3423e",
    "seeker_env.py": "8250a92e7823cb844bffbf2cfe47879c0b9dc2010bc511c72c80157921a0310f",
    "seeker_recurrent_policy.py": "3f9fc5f444fc15bb49d11135f2befe7eebc8da4fd0bae2bf9d37b942dcb93b1c",
}


class FrozenRecipeTests(unittest.TestCase):
    def test_frozen_files_are_unchanged(self):
        # Any edit here changes what the saved policy sees; it must fail loudly.
        for name, expected in PINNED.items():
            with self.subTest(file=name):
                digest = hashlib.sha256((FROZEN / name).read_bytes()).hexdigest()
                self.assertEqual(digest, expected, f"{name} changed; the 7,757,824 brain recipe is frozen")

    def test_game_imports_only_the_frozen_recipe(self):
        # The junkyard env/server must not import the evolving lab modules.
        for name in ("junkyard_env.py", "junkyard_server.py"):
            source = (ROOT / "rl" / name).read_text(encoding="utf-8")
            with self.subTest(file=name):
                self.assertNotIn("from rl.seeker_env ", source)
                self.assertNotIn("from rl.seeker_recurrent_policy ", source)
                self.assertNotIn("from rl_environment ", source)


if __name__ == "__main__":
    unittest.main()
