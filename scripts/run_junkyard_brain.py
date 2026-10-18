"""Start with a Python 3.12 runtime; reuse this project's installed RL packages."""
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
packages = root / ".venv/Lib/site-packages"
if packages.exists():
    sys.path.insert(0, str(packages))

from rl.junkyard_server import main

main()
