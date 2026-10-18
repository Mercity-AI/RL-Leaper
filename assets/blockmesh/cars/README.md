# Junkyard car blockmeshes

Two simple placeholder cars inspired by the supplied junkyard concept: a blue
sedan and a dark burgundy hatchback. Each car is one mesh object.
Use them to judge spacing, car racks, scrap piles, and routes around obstacles.

- `blue_sedan.obj`: approximately 4.38 m long, 1.89 m wide, 1.43 m tall.
- `burgundy_hatchback.obj`: approximately 3.88 m long, 1.89 m wide, 1.49 m tall.
- `cars.mtl`: shared flat-colour materials. Keep beside both OBJ files.
- `preview.png`: view of the actual generated geometry.

Unzip the pack, then import either OBJ in your 3D editor. Enable materials if
your importer provides that option. Source coordinates use metres, Y up, and
+Z toward the headlights; the origin is at ground level beneath the car.
If the import dialog asks for source axes, choose Y up and Z forward.
Body, cabin, glass, bumpers, lights, tires, and hubs belong to a single object
per car, with multiple materials. Disable splitting by material if your importer
offers that option. The two cars remain separate assets for individual placement.

These are static layout props with triangulated flat-shaded geometry. Windows
are opaque dark panels. Pieces overlap intentionally; there is no interior,
texture map, rig, suspension, wheel animation, or collision setup. Wheel arches
are omitted for this first blockmesh. These assets are not yet placed in-game.

To reproduce the meshes and preview, run `generate.py` with Python, NumPy, and
Pillow installed. Geometry generation uses only procedural shapes.
