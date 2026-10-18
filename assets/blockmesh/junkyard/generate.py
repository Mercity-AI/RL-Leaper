"""Reproducible untextured junkyard props. Requires NumPy and Pillow."""
from pathlib import Path
import math
import json
import zipfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent


def rotation(x=0, y=0, z=0):
    x, y, z = np.radians([x, y, z])
    cx, cy, cz = np.cos([x, y, z]); sx, sy, sz = np.sin([x, y, z])
    return np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]) @ np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]) @ np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])


class Mesh:
    def __init__(self):
        self.v, self.f = [], []

    def add(self, vertices, faces, convex=False):
        vertices = np.array(vertices, dtype=float)
        center = vertices.mean(axis=0)
        offset = len(self.v)
        self.v.extend(vertices.tolist())
        for face in faces:
            face = list(face)
            p = vertices[face]
            if convex and np.dot(np.cross(p[1] - p[0], p[2] - p[0]), p.mean(axis=0) - center) < 0:
                face.reverse()
            for i in range(1, len(face) - 1):
                self.f.append(tuple(offset + j for j in (face[0], face[i], face[i + 1])))

    def merge(self, other, pos=(0, 0, 0), rot=None):
        vertices = np.array(other.v)
        if rot is not None:
            vertices = vertices @ rot.T
        self.add(vertices + pos, other.f)

    def box(self, pos, size, rot=None):
        p = np.array([(x, y, z) for z in (-.5, .5) for y in (-.5, .5) for x in (-.5, .5)]) * size
        if rot is not None:
            p = p @ rot.T
        self.add(p + pos, [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)], True)

    def beam(self, a, b, width, depth=None):
        a, b = np.array(a, float), np.array(b, float)
        axis = b - a; length = np.linalg.norm(axis); axis /= length
        ref = np.array([0, 1, 0]) if abs(axis[1]) < .9 else np.array([1, 0, 0])
        side = np.cross(axis, ref); side /= np.linalg.norm(side)
        self.box((a + b) / 2, (width, length, depth or width), np.column_stack([side, axis, np.cross(side, axis)]))

    def cylinder(self, a, b, radius, sides=10):
        a, b = np.array(a, float), np.array(b, float)
        axis = b - a; axis /= np.linalg.norm(axis)
        ref = np.array([0, 1, 0]) if abs(axis[1]) < .9 else np.array([1, 0, 0])
        u = np.cross(axis, ref); u /= np.linalg.norm(u); v = np.cross(axis, u)
        ring = [radius * (math.cos(i * math.tau / sides) * u + math.sin(i * math.tau / sides) * v) for i in range(sides)]
        vertices = [p + c for c in (a, b) for p in ring]
        faces = [list(range(sides)), list(range(sides, 2 * sides))]
        faces += [[i, (i + 1) % sides, (i + 1) % sides + sides, i + sides] for i in range(sides)]
        self.add(vertices, faces, True)

    def ground(self):
        p = np.array(self.v)
        p[:, 1] -= p[:, 1].min()
        p[:, [0, 2]] -= (p[:, [0, 2]].min(axis=0) + p[:, [0, 2]].max(axis=0)) / 2
        self.v = p.tolist()
        return self


def tire():
    m = Mesh()
    # Eight-point section, open centre; wheel axis is vertical for easy stacking.
    profile = [(.20, -.08), (.23, -.12), (.31, -.12), (.35, -.08), (.35, .08), (.31, .12), (.23, .12), (.20, .08)]
    vertices = [(r * math.cos(i * math.tau / 12), y, r * math.sin(i * math.tau / 12)) for i in range(12) for r, y in profile]
    faces = []
    for i in range(12):
        for j in range(8):
            faces.append([i * 8 + j, i * 8 + (j + 1) % 8, ((i + 1) % 12) * 8 + (j + 1) % 8, ((i + 1) % 12) * 8 + j])
    m.add(vertices, faces)
    return m


def tire_heap():
    m = Mesh(); t = tire()
    # Four short stacks and two leaning tires, twelve in total.
    for x, z, count in [(-.39, -.36, 3), (.37, -.35, 3), (-.4, .38, 2), (.36, .38, 2)]:
        for level in range(count):
            m.merge(t, (x + .025 * level, .13 + .24 * level, z - .025 * level), rotation(0, level * 17, 0))
    m.merge(t, (.85, .36, .23), rotation(0, 25, 65))
    m.merge(t, (-.22, .84, -.05), rotation(12, 30, -14))
    return m


def skip(long=False):
    m = Mesh()
    w, length, h = (2.1, 3.8, 1.25) if long else (1.8, 2.4, 1.45)
    m.box((0, .11, 0), (w * .80, .16, length * .80))
    # Splayed, thick walls with open top, plus reinforced rim and ribs.
    bottom = [(-w*.4, .16, -length*.4), (w*.4, .16, -length*.4), (w*.4, .16, length*.4), (-w*.4, .16, length*.4)]
    top = [(-w*.5, h, -length*.5), (w*.5, h, -length*.5), (w*.5, h, length*.5), (-w*.5, h, length*.5)]
    for i in range(4):
        j = (i + 1) % 4
        outer = np.array([bottom[i], bottom[j], top[j], top[i]])
        inner = outer.copy(); inner[:, [0, 2]] *= .94
        m.add(np.vstack([outer, inner]), [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], True)
        m.beam(top[i], top[j], .12)
        for t in (.25, .5, .75):
            a = (1-t)*np.array(bottom[i])+t*np.array(bottom[j])
            b = (1-t)*np.array(top[i])+t*np.array(top[j])
            m.beam(a, b, .07)
    for x in (-w*.31, w*.31):
        m.box((x, .045, 0), (.15, .09, length*.9))
    for x in (-w*.52, w*.52):
        m.box((x, h*.70, 0), (.12, .18, .38))
    return m


def engine():
    m = Mesh()
    m.box((0, .22, 0), (.5, .4, .65))
    for x in (-.18, .18):
        m.box((x, .48, 0), (.23, .25, .70), rotation(0, 0, -25 if x < 0 else 25))
        for z in (-.23, 0, .23):
            m.cylinder((x*1.6, .34, z), (x*2.3, .20, z), .055, 6)
    m.cylinder((0, .23, -.34), (0, .23, -.46), .22, 10)
    m.box((0, .08, .48), (.24, .22, .4), rotation(10, 0, 0))
    return m


def scrap():
    m = Mesh()
    rng = np.random.default_rng(21)
    # Sample actual triangle surfaces on a 1 cm grid. Lower each complete piece
    # until it contacts the ground or an already placed piece, instead of giving
    # it an arbitrary height. A tiny overlap hides rasterization-sized gaps.
    grid = np.arange(-2, 2.001, .01)
    xx, zz = np.meshgrid(grid, grid)
    support = np.zeros_like(xx)

    def place(piece, x, z, rot, ground_only=False):
        p = np.array(piece.v) @ rot.T + [x, 0, z]
        lower = np.full_like(xx, np.inf)
        upper = np.full_like(xx, -np.inf)
        for face in piece.f:
            a, b, c = p[list(face)]
            den = (b[2]-c[2])*(a[0]-c[0]) + (c[0]-b[0])*(a[2]-c[2])
            if abs(den) < 1e-10:
                continue
            u = ((b[2]-c[2])*(xx-c[0])+(c[0]-b[0])*(zz-c[2]))/den
            v = ((c[2]-a[2])*(xx-c[0])+(a[0]-c[0])*(zz-c[2]))/den
            w = 1-u-v
            inside = (u>=0)&(v>=0)&(w>=0)
            y = u*a[1]+v*b[1]+w*c[1]
            lower[inside] = np.minimum(lower[inside], y[inside])
            upper[inside] = np.maximum(upper[inside], y[inside])
        valid = np.isfinite(lower)
        floor_shift = -p[:,1].min()
        shift = floor_shift if ground_only else max(floor_shift, float(np.max(support[valid]-lower[valid]))-.006)
        p[:,1] += shift
        assert p[:,1].min() >= -1e-8
        assert ground_only or np.min(np.abs(lower[valid]+shift-support[valid])) < .02
        m.add(p, piece.f)
        support[valid] = np.maximum(support[valid], upper[valid]+shift)

    # Heavy engine assemblies form a grounded, low base with readable silhouettes.
    for x,z,yaw in [(-.48,-.22,25),(.43,-.28,-35),(.06,.55,95)]:
        place(engine(),x,z,rotation(0,yaw,0),ground_only=True)
    # Loose perimeter bars and sheets start on the ground and lean only gently.
    for i in range(18):
        angle = i*math.tau/18 + rng.uniform(-.1,.1)
        radius = rng.uniform(.78,1.15)
        piece = Mesh()
        if i % 3 == 0:
            piece.box((0,0,0),(rng.uniform(.35,.58),.045,rng.uniform(.3,.5)))
        else:
            piece.box((0,0,0),(.09,.075,rng.uniform(.4,.7)))
        place(piece,math.cos(angle)*radius,math.sin(angle)*radius,
              rotation(rng.uniform(-4,4),rng.uniform(0,180),rng.uniform(-4,4)), ground_only=True)
    # Short, broad metal pieces settle onto the engines; no suspended roof of scrap.
    for x,z,yaw in [(-.37,-.24,25),(.40,-.28,-35),(.02,.51,95)]:
        piece=Mesh()
        piece.box((0,0,0),(.52,.045,.39),rotation(0,0,5))
        piece.box((.29,.045,0),(.12,.045,.39),rotation(0,0,32))
        place(piece,x,z,rotation(0,yaw,0))
    for x,z,yaw in [(-.77,.33,40),(.73,.22,-20)]:
        piece=Mesh()
        piece.cylinder((0,0,-.24),(0,0,.24),.10,8)
        place(piece,x,z,rotation(0,yaw,0),ground_only=True)
    return m


def cabinet():
    m = Mesh()
    m.box((0,.62,0),(.72,1.2,.65))
    m.box((0,1.25,0),(.8,.09,.72))
    m.box((0,.07,0),(.78,.14,.7))
    m.box((0,.64,.337),(.62,1.02,.035))
    m.box((.22,.66,.375),(.035,.18,.05))
    for y in (.84,.90,.96,1.02):
        m.box((0,y,.366),(.41,.025,.025),rotation(-20,0,0))
    return m


def crane():
    m = Mesh()
    # Crawler tracks with chamfered ends, pads and inset road wheels.
    for x in (-1.05,1.05):
        profile = [(-1.75,.22),(-1.5,.06),(1.5,.06),(1.75,.22),(1.75,.62),(1.5,.80),(-1.5,.80),(-1.75,.62)]
        p = [(xx,y,z) for xx in (x-.29,x+.29) for z,y in profile]
        faces = [list(range(8)),list(range(8,16))] + [[i,(i+1)%8,(i+1)%8+8,i+8] for i in range(8)]
        m.add(p,faces,True)
        for z in np.linspace(-1.4,1.4,10):
            m.box((x,.81,z),(.64,.055,.16))
        for z in (-1.18,-.6,0,.6,1.18):
            m.cylinder((x-.305,.41,z),(x+.305,.41,z),.255,10)
    m.box((0,.78,0),(1.9,.32,2.65))
    m.cylinder((0,.94,0),(0,1.16,0),.84,12)
    m.box((0,1.27,-.15),(2.35,.35,2.7))
    m.box((0,1.65,-1.08),(2.3,.65,.7))
    m.box((.6,1.74,-.20),(.9,.6,1.2))
    for z in np.linspace(-.62,.2,6):
        m.box((.6,2.055,z),(.72,.055,.045))
    # Cab has actual open window areas bounded by chunky frames: no colour needed.
    m.box((-.73,1.62,.48),(.96,.45,1.25))
    for x in (-1.18,-.28):
        for z in (-.1,1.07):
            m.beam((x,1.83,z),(x,2.85,z),.075)
    m.box((-.73,2.89,.48),(1.08,.13,1.35))
    for x in (-1.18,-.28):
        m.beam((x,2.34,-.1),(x,2.34,1.07),.055)
    m.box((-.73,1.92,.2),(.4,.2,.4))
    m.box((-.73,2.15,.01),(.4,.5,.12),rotation(-10,0,0))
    m.box((-.73,2.0,.82),(.76,.18,.25))
    # Two articulated boom sections, visible hydraulic cylinders and hinge pins.
    a,b,c = (.2,1.63,.65),(.2,5.6,2.18),(.2,4.2,4.5)
    m.beam(a,b,.42,.55); m.beam(b,c,.30,.40)
    for point in (a,b,c):
        x,y,z = point
        m.cylinder((x-.34,y,z),(x+.34,y,z),.21,10)
    m.cylinder((.52,1.7,1.05),(.52,3.65,1.48),.115,8)
    m.cylinder((.52,3.65,1.48),(.52,4.7,1.84),.065,8)
    m.cylinder((.52,4.95,1.98),(.52,4.83,3.16),.105,8)
    m.cylinder((.52,4.83,3.16),(.52,4.55,3.9),.06,8)
    m.cylinder(c,(.2,3.65,4.5),.065,8)
    m.cylinder((.2,3.65,4.5),(.2,3.32,4.5),.24,10)
    # Four open grapple fingers, curled inward at their tips.
    for angle in (0,math.pi/2,math.pi,3*math.pi/2):
        def point(r,y):
            return (.2+r*math.cos(angle),y,4.5+r*math.sin(angle))
        points=[point(.16,3.4),point(.53,3.03),point(.59,2.65),point(.29,2.37)]
        for i in range(3):
            m.beam(points[i],points[i+1],.14 if i<2 else .10)
    # Access steps and exhaust give readable construction-machine details.
    for y,z in [(1.04,1.25),(1.23,1.10)]:
        m.box((-.78,y,z),(.72,.09,.28))
    m.cylinder((.86,2.02,-.67),(.86,2.72,-.67),.075,8)
    return m


def render(mesh, size=(700, 520), eye=(1.15,.85,1.4)):
    width,height=size
    canvas=np.full((height,width,3),239,dtype=np.uint8)
    depth=np.full((height,width),-np.inf)
    eye=np.array(eye,float); eye/=np.linalg.norm(eye)
    right=np.cross([0,1,0],eye); right/=np.linalg.norm(right)
    up=np.cross(eye,right); basis=np.array([right,up,eye])
    points=np.array(mesh.v)@basis.T
    bounds=np.ptp(points[:,:2],axis=0)
    scale=min((width-80)/bounds[0],(height-70)/bounds[1])
    center=(points[:,:2].min(axis=0)+points[:,:2].max(axis=0))/2
    points[:,0]=(points[:,0]-center[0])*scale+width/2
    points[:,1]=height/2-(points[:,1]-center[1])*scale
    light=np.array([-.5,1,.7]); light/=np.linalg.norm(light)
    for face in mesh.f:
        original=np.array([mesh.v[i] for i in face])
        normal=np.cross(original[1]-original[0],original[2]-original[0]); normal/=np.linalg.norm(normal)
        if np.dot(normal,eye)<=0: continue
        p=points[list(face)]; a,b,c=p
        x0=max(0,int(np.floor(p[:,0].min()))); x1=min(width-1,int(np.ceil(p[:,0].max())))
        y0=max(0,int(np.floor(p[:,1].min()))); y1=min(height-1,int(np.ceil(p[:,1].max())))
        x,y=np.meshgrid(np.arange(x0,x1+1)+.5,np.arange(y0,y1+1)+.5)
        den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den)<1e-10: continue
        u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den
        v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den
        w=1-u-v; z=u*a[2]+v*b[2]+w*c[2]
        area=depth[y0:y1+1,x0:x1+1]
        mask=(u>=-1e-8)&(v>=-1e-8)&(w>=-1e-8)&(z>area)
        shade=int(190*(.52+.48*max(0,np.dot(normal,light))))
        canvas[y0:y1+1,x0:x1+1][mask]=shade; area[mask]=z[mask]
    return Image.fromarray(canvas)


if __name__ == '__main__':
    models=[('tire_single',tire()),('tire_heap_12',tire_heap()),('scrap_bin_tall',skip()),('scrap_skip_long',skip(True)),('scrap_heap_engines',scrap()),('sorting_crane',crane()),('edge_utility_cabinet',cabinet())]
    manifest=[]
    for name,mesh in models:
        mesh.ground()
        points=np.array(mesh.v)
        assert np.isfinite(points).all()
        for face in mesh.f:
            p=points[list(face)]
            assert np.linalg.norm(np.cross(p[1]-p[0],p[2]-p[0]))>1e-10
        lines=['# Metres; Y up; one mesh object; no materials or textures',f'o {name}','s off']
        lines += ['v '+' '.join(f'{v:.6f}' for v in p) for p in mesh.v]
        lines += ['f '+' '.join(str(i+1) for i in f) for f in mesh.f]
        (ROOT/f'{name}.obj').write_text('\n'.join(lines)+'\n')
        manifest.append({'asset':name,'objects':1,'triangles':len(mesh.f),'dimensions_xyz_m':np.round(np.ptp(points,axis=0),3).tolist()})
        render(mesh).save(ROOT/f'{name}.png')
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    sheet=Image.new('RGB',(1500,1920),(239,239,239)); draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',26)
    title=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf',38)
    draw.text((750,44),'JUNKYARD / LOW-POLY PROP PACK',font=title,fill='#303030',anchor='mm')
    labels=['Single tire','12-tire heap','Tall scrap bin','Long scrap skip','Scrap + engine heap','Sorting crane','Edge utility cabinet']
    for i,((name,mesh),label) in enumerate(zip(models,labels)):
        col=i%2; row=i//2
        pic=render(mesh,(720,375))
        sheet.paste(pic,(15+750*col,100+450*row))
        draw.text((375+750*col,494+450*row),label,font=font,fill='#303030',anchor='mm')
    draw.text((1125,1570),'One object per asset',font=font,fill='#555555',anchor='mm')
    draw.text((1125,1620),'No materials / no textures',font=font,fill='#555555',anchor='mm')
    sheet.save(ROOT/'preview.png')
    with zipfile.ZipFile(ROOT/'junkyard_uncoloured_props.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for name,_ in models:
            archive.write(ROOT/f'{name}.obj',f'{name}.obj')
        for name in ['README.md','asset_checklist.md','manifest.json','preview.png']:
            archive.write(ROOT/name,name)
    print(json.dumps(manifest,indent=2))
