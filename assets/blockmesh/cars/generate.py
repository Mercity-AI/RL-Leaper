"""Generate deliberately simple, metre-scale OBJ cars and a mesh preview."""
from pathlib import Path
import math
import zipfile

import numpy as np

ROOT = Path(__file__).resolve().parent
COLORS = {
    "blue_paint": (0.20, 0.43, 0.57),
    "burgundy_paint": (0.28, 0.095, 0.13),
    "dark_windows": (0.10, 0.18, 0.23),
    "rubber": (0.075, 0.085, 0.09),
    "wheel_hubs": (0.43, 0.47, 0.48),
    "bumper": (0.21, 0.24, 0.25),
    "headlights": (0.86, 0.85, 0.70),
    "taillights": (0.57, 0.16, 0.12),
}


class Mesh:
    def __init__(self):
        self.vertices = []
        self.faces = []

    def part(self, name, material, vertices, faces):
        offset = len(self.vertices)
        self.vertices.extend(vertices)
        for face in faces:
            for i in range(1, len(face) - 1):
                self.faces.append((name, material, tuple(offset + j for j in (face[0], face[i], face[i + 1]))))

    def prism(self, name, material, sections):
        # Each section is z, half-width, bottom, top. Winding is corrected outward.
        vertices = []
        for z, w, bottom, top in sections:
            vertices.extend([(-w, bottom, z), (w, bottom, z), (w, top, z), (-w, top, z)])
        faces = [(3, 2, 1, 0)]
        for s in range(len(sections) - 1):
            for j in range(4):
                a, b = 4 * s + j, 4 * s + (j + 1) % 4
                faces.append((a, b, b + 4, a + 4))
        n = 4 * (len(sections) - 1)
        faces.append(tuple(n + j for j in range(4)))
        self.part(name, material, vertices, faces)

    def box(self, name, material, x0, x1, y0, y1, z0, z1):
        vertices = [(x, y, z) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
        self.part(name, material, vertices, [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)])

    def wheel(self, name, material, x0, x1, z, radius):
        vertices = [(x, 0.34 + radius * math.cos(i * math.tau / 12), z + radius * math.sin(i * math.tau / 12)) for x in (x0, x1) for i in range(12)]
        faces = [tuple(range(12)), tuple(reversed(range(12, 24)))]
        faces.extend((i, i + 12, (i + 1) % 12 + 12, (i + 1) % 12) for i in range(12))
        self.part(name, material, vertices, [tuple(reversed(face)) for face in faces])


def make_car(hatch=False):
    mesh = Mesh()
    back = -1.82 if hatch else -2.15
    front = 1.98 if hatch else 2.15
    mesh.prism("body", "blue_paint", [(back, .77, .36, .83), (back + .20, .86, .32, .96), (front - .22, .86, .32, .96), (front, .77, .38, .83)])
    rear_base = -1.52 if hatch else -1.27
    rear_roof = -1.22 if hatch else -.79
    roof_y = 1.49 if hatch else 1.43
    # Trapezoidal cabin: four corners around its base, then around its roof.
    vertices = [(-.79, .96, rear_base), (.79, .96, rear_base), (.79, .96, 1.02), (-.79, .96, 1.02), (-.65, roof_y, rear_roof), (.65, roof_y, rear_roof), (.65, roof_y, .46), (-.65, roof_y, .46)]
    mesh.part("cabin", "blue_paint", vertices, [(4, 5, 1, 0), (5, 6, 2, 1), (6, 7, 3, 2), (7, 4, 0, 3), (7, 6, 5, 4), (1, 2, 3, 0)])
    # Inset glass patches retain blue pillars and roof borders.
    def glass(name, corners):
        p = np.array([vertices[i] for i in reversed(corners)])
        center = p.mean(axis=0)
        p = center + (p - center) * .82
        normal = np.cross(p[1] - p[0], p[2] - p[0])
        p += normal / np.linalg.norm(normal) * .003
        mesh.part(name, "dark_windows", p.tolist(), [(0, 1, 2, 3)])
    glass("rear_window", [0, 1, 5, 4])
    glass("windshield", [2, 3, 7, 6])
    glass("right_windows", [1, 2, 6, 5])
    glass("left_windows", [3, 0, 4, 7])
    # Simple blue centre pillars, aligned with the sloped side glass.
    for sign in (-1, 1):
        p = [(sign * .795, .98, -.20), (sign * .795, .98, -.11), (sign * .655, roof_y - .01, -.11), (sign * .655, roof_y - .01, -.20)]
        mesh.part(f"pillar_{sign}", "blue_paint", p, [(0, 1, 2, 3)] if sign < 0 else [(3, 2, 1, 0)])
    for label, z in (("front", 1.28), ("rear", -1.12 if hatch else -1.34)):
        for side, a, b in (("left", -.94, -.74), ("right", .74, .94)):
            mesh.wheel(f"{label}_{side}_tire", "rubber", a, b, z, .34)
            ha, hb = ((-.946, -.94) if side == "left" else (.94, .946))
            mesh.wheel(f"{label}_{side}_hub", "wheel_hubs", ha, hb, z, .17)
    for label, z0, z1 in (("front", front - .04, front + .04), ("rear", back - .04, back + .04)):
        mesh.box(f"{label}_bumper", "bumper", -.76, .76, .44, .59, z0, z1)
        for side, x0, x1 in (("left", -.69, -.37), ("right", .37, .69)):
            mesh.box(f"{label}_{side}_light", "headlights" if label == "front" else "taillights", x0, x1, .66, .79, z0, z1)
    if hatch:
        mesh.faces = [(obj, "burgundy_paint" if material == "blue_paint" else material, face)
                      for obj, material, face in mesh.faces]
    return mesh


def save(name, mesh):
    lines = ["# Leaper car blockmesh | metres | Y up | +Z front | ground-centred origin", "mtllib cars.mtl", "s off"]
    lines.extend("v " + " ".join(f"{v:.6f}" for v in p) for p in mesh.vertices)
    lines.append(f"o {name}")
    last = None
    for _, material, face in mesh.faces:
        if material != last:
            lines.append(f"usemtl {material}")
            last = material
        lines.append("f " + " ".join(str(i + 1) for i in face))
    (ROOT / f"{name}.obj").write_text("\n".join(lines) + "\n")
    print(f"{name}: {len(mesh.vertices)} vertices, {len(mesh.faces)} triangles")


def preview(models):
    # Orthographic triangle rasterization with a depth buffer, so overlapping
    # blockmesh pieces and glass are shown with proper visibility.
    from PIL import Image, ImageDraw, ImageFont
    width, height = 1600, 800
    canvas = np.full((height, width, 3), [238, 234, 226], dtype=np.uint8)
    depth = np.full((height, width), -np.inf)
    eye = np.array([1.0, .68, 1.25]); eye /= np.linalg.norm(eye)
    right = np.cross([0, 1, 0], eye); right /= np.linalg.norm(right)
    up = np.cross(eye, right)
    basis = np.array([right, up, eye])
    light = np.array([-.4, 1, .7]); light /= np.linalg.norm(light)
    for model_index, (_, mesh) in enumerate(models):
        center_x = 410 + model_index * 780
        for _, material, face in mesh.faces:
            vertices = np.array([mesh.vertices[j] for j in face])
            normal = np.cross(vertices[1] - vertices[0], vertices[2] - vertices[0])
            assert np.linalg.norm(normal) > 1e-10
            normal /= np.linalg.norm(normal)
            if np.dot(normal, eye) <= 0:
                continue
            projected = vertices @ basis.T
            projected[:, 0] = projected[:, 0] * 145 + center_x
            projected[:, 1] = 505 - projected[:, 1] * 145
            x0 = max(0, int(np.floor(projected[:, 0].min())))
            x1 = min(width - 1, int(np.ceil(projected[:, 0].max())))
            y0 = max(0, int(np.floor(projected[:, 1].min())))
            y1 = min(height - 1, int(np.ceil(projected[:, 1].max())))
            x, y = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
            a, b, c = projected
            denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(denominator) < 1e-10:
                continue
            u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator
            v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator
            w = 1 - u - v
            z = u * a[2] + v * b[2] + w * c[2]
            area = depth[y0:y1 + 1, x0:x1 + 1]
            mask = (u >= -1e-8) & (v >= -1e-8) & (w >= -1e-8) & (z > area)
            shade = .65 + .35 * max(0, np.dot(normal, light))
            canvas[y0:y1 + 1, x0:x1 + 1][mask] = np.array(COLORS[material]) * shade * 255
            area[mask] = z[mask]
    image = Image.fromarray(canvas)
    draw = ImageDraw.Draw(image)
    def label(text, xy, size):
        font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', size)
        draw.text(xy, text, font=font, fill='#273943', anchor='mm')
    label('JUNKYARD / CAR BLOCKMESH', (800, 85), 42)
    for i, (title, _) in enumerate(models):
        label(title, (410 + i * 780, 645), 30)
    label('Simple shapes / flat colours / real-world scale', (800, 730), 22)
    image.save(ROOT / 'preview.png')


if __name__ == "__main__":
    materials = []
    for name, color in COLORS.items():
        materials.extend([f"newmtl {name}", "Kd " + " ".join(map(str, color)), "Ka 0.1 0.1 0.1", "Ks 0 0 0", "illum 1", ""])
    (ROOT / "cars.mtl").write_text("\n".join(materials))
    sedan, hatch = make_car(), make_car(True)
    save("blue_sedan", sedan)
    save("burgundy_hatchback", hatch)
    preview([("01 / Everyday sedan", sedan), ("02 / Compact hatchback", hatch)])
    with zipfile.ZipFile(ROOT / "junkyard_car_blockmeshes.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for name in ("blue_sedan.obj", "burgundy_hatchback.obj", "cars.mtl", "README.md", "preview.png"):
            archive.write(ROOT / name, arcname=name)
