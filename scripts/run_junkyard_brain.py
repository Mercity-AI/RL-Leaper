"""Start the local Leaper brain service (same as `python -m rl.junkyard_server`).

Run it with the project's virtual environment's Python 3.12, set up from
requirements-brain.txt. `pnpm play` starts it for you.
"""
import sys
from pathlib import Path

# Lets `python scripts/run_junkyard_brain.py` import the project's rl package.
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))

from rl.junkyard_server import main

main()
