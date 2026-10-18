"""Move the three loose tires north in the browser export and rebuild collision.

Run once from the original export. Source Blender files are never modified.
The marker prevents accidentally applying the move twice.
"""
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Lets `python scripts/move_junkyard_tires.py` import the project's rl package.
# Run it with the project's virtual environment's Python.
sys.path.insert(0, str(ROOT))
from rl.junkyard_sight import load_triangles

path = ROOT / 'assets/maps/junkyard/junkyard.glb'
raw = path.read_bytes()
size = struct.unpack_from('<I', raw, 12)[0]
document = json.loads(raw[20:20 + size])
marker = 'north_tire_clearance_v1'
if document.get('extras', {}).get(marker):
    raise SystemExit('Tire clearance adjustment already applied.')
names = {'truck_tire_single.006', 'truck_tire_single.007', 'truck_tire_single.008'}
# Extract only the affected original triangles for matching the collision export.
import copy
import numpy as np

subset = copy.deepcopy(document)
subset['scenes'][subset.get('scene', 0)]['nodes'] = [
    i for i, node in enumerate(subset['nodes']) if node.get('name') in names]
part = json.dumps(subset, separators=(',', ':')).encode()
part += b' ' * (-len(part) % 4)
temporary = ROOT / 'tmp/tire-source.glb'
temporary.parent.mkdir(exist_ok=True)
temporary.write_bytes(struct.pack('<4sII', b'glTF', 2, 20 + len(part) + len(raw[20 + size:]))
    + struct.pack('<II', len(part), 0x4E4F534A) + part + raw[20 + size:])
source_triangles = load_triangles(temporary)
def signature(triangle):
    points = sorted((float(v[0]), float(v[2])) for v in triangle)
    return [n for pair in points for n in pair] + [float(triangle[:,1].min()), float(triangle[:,1].max())]
signatures = np.array([signature(t) for t in source_triangles if t[:,1].max() > .12])
found = []
for node in document['nodes']:
    if node.get('name') in names:
        node['translation'][2] -= 2.5
        found.append(node['name'])
assert set(found) == names
document.setdefault('extras', {})[marker] = {'objects': sorted(names), 'delta': [0, 0, -2.5]}
chunk = json.dumps(document, separators=(',', ':')).encode()
chunk += b' ' * (-len(chunk) % 4)
tail = raw[20 + size:]
path.write_bytes(struct.pack('<4sII', b'glTF', 2, 20 + len(chunk) + len(tail))
                 + struct.pack('<II', len(chunk), 0x4E4F534A) + chunk + tail)
# Translate only matching original tire triangles, retaining every other
# collision triangle byte-for-byte as values from the Blender export.
collision_path = path.with_name('collision.json')
collision = json.loads(collision_path.read_text())
moved = 0
for tri in collision['triangles']:
    signature = [v for pair in sorted(zip(tri[:6:2], tri[1:6:2])) for v in pair] + tri[6:]
    if np.any(np.array(signature) < signatures.min(axis=0) - .0002) or np.any(np.array(signature) > signatures.max(axis=0) + .0002):
        continue
    distance = np.linalg.norm(signatures - signature, axis=1).min()
    if distance < 0.0002:
        for index in (1, 3, 5):
            tri[index] = round(tri[index] - 2.5, 5)
        moved += 1
assert moved == len(signatures), (moved, len(signatures))
collision['layoutAdjustment'] = document['extras'][marker]
collision_path.write_text(json.dumps(collision, separators=(',', ':')), encoding='utf-8')
print(f'Moved {found} north by 2.5 map units; translated exactly {moved} tire collision triangles.')
