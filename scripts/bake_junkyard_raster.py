"""Bake the Leaper's collision raster so the browser does not have to build it.

Run from the repository root:

    python scripts/bake_junkyard_raster.py            # default Leaper width 5.5
    python scripts/bake_junkyard_raster.py 5.5 4.0    # several widths

The raster is built by the oracle itself (rl/junkyard_geometry.py, ~30 s per
width) and saved as public/brains/leaper_7757824/raster-<width>.bin. The browser
brain (src/brain/junkyard/collisionRaster.js) loads it instantly; for any other
width it builds the same grid in JavaScript. tests/brain-raster.test.js checks
the JavaScript build is bit-identical to this file.

File layout (little-endian): 'LJR1', nx, nz, solid-cell count (uint32), width,
scale, minX, maxX, minZ, maxZ (float64), SHA256 of collision.json (32 bytes),
then one bit per cell in row-major [ix][iz] order, least significant bit first.
"""
import hashlib
import json
import struct
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from rl.junkyard_geometry import JunkyardGeometry  # noqa: E402

COLLISION = ROOT / "assets/maps/junkyard/collision.json"
OUT = ROOT / "public/brains/leaper_7757824"
BODY_DIAMETER = 7.98  # the server's 7.98 / width map scale


def bake(width):
    """Build the raster exactly like junkyard_server.py and write the .bin file."""
    started = time.time()
    raw = COLLISION.read_bytes()
    bounds = json.loads(raw)["bounds"]
    scale = BODY_DIAMETER / width
    geometry = JunkyardGeometry(COLLISION, scale)
    solid = np.ascontiguousarray(geometry.solid, dtype=np.uint8)
    nx, nz = (int(v) for v in solid.shape)
    header = (b"LJR1" + struct.pack("<3I", nx, nz, int(solid.sum()))
              + struct.pack("<6d", width, scale, bounds["minX"], bounds["maxX"], bounds["minZ"], bounds["maxZ"])
              + hashlib.sha256(raw).digest())
    body = np.packbits(solid.ravel(), bitorder="little").tobytes()
    path = OUT / f"raster-{width:g}.bin"
    path.write_bytes(header + body)
    digest = hashlib.sha256(solid.tobytes()).hexdigest()
    print(f"width {width:g}: {nx}x{nz} cells, {int(solid.sum()):,} solid, {len(header) + len(body):,} bytes "
          f"in {time.time() - started:.1f} s -> {path.relative_to(ROOT)}")
    return dict(file=path.name, shape=[nx, nz], solid=int(solid.sum()), raster_sha256=digest,
                collision_sha256=hashlib.sha256(raw).hexdigest())


def main():
    widths = [float(value) for value in sys.argv[1:]] or [5.5]
    OUT.mkdir(parents=True, exist_ok=True)
    # Record the baked widths in brain.json so the browser knows which files exist.
    manifest_path = OUT / "brain.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    rasters = manifest.setdefault("rasters", {})
    for width in widths:
        rasters[f"{width:g}"] = bake(width)
    manifest_path.write_text(json.dumps(manifest, indent=1) + "\n")


if __name__ == "__main__":
    main()
