"""Static, uncoloured junkyard landmarks. Run after the other generators."""
import importlib.util
import json
import math
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from generate import ROOT, Mesh, rotation, render


def car_mesh(hatch=False):
    spec = importlib.util.spec_from_file_location('car_assets', ROOT.parent/'cars'/'generate.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    source = module.make_car(hatch)
    mesh = Mesh()
    mesh.add(source.vertices, [face for _, _, face in source.faces])
    return mesh


def rack(loaded=True):
    mesh = Mesh()
    # Three side-by-side bays; two levels. Deck tops support the tires directly.
    for x in (-3.9,-1.3,1.3,3.9):
        for z in (-2.45,2.45):
            mesh.box((x,2.05,z),(.16,4.1,.16))
            mesh.box((x,.06,z),(.4,.12,.4))
    for top in (.24,2.35):
        for z in (-2.4,2.4):
            mesh.box((0,top-.12,z),(7.95,.24,.16))
        for x in (-2.6,0,2.6):
            for wheel_x in (-.81,.81):
                mesh.box((x+wheel_x,top-.075,0),(.44,.15,4.8))
            for z in (-1.35,1.28):
                mesh.box((x,top-.14,z),(2.6,.12,.12))
    for a,b in [((-3.9,.3,-2.46),(-1.3,3.95,-2.46)),((-1.3,.3,-2.46),(-3.9,3.95,-2.46)),((1.3,.3,-2.46),(3.9,3.95,-2.46)),((3.9,.3,-2.46),(1.3,3.95,-2.46))]:
        mesh.beam(a,b,.08)
    if loaded:
        for level,y in enumerate((.24,2.35)):
            for bay,x in enumerate((-2.6,0,2.6)):
                mesh.merge(car_mesh((bay+level)%2==1),(x,y,0))
    return mesh


def press():
    mesh=Mesh()
    mesh.box((0,.18,0),(3.1,.36,6.4))
    # Open loading chamber at the front; rear ram pushes toward its end wall.
    mesh.box((0,.48,1.05),(2.65,.24,3.9))
    for x in (-1.35,1.35):
        mesh.box((x,1.03,1.05),(.22,1.1,3.9))
        for z in (-.65,.3,1.25,2.2,2.9):
            mesh.box((x*1.1,1.0,z),(.16,1.2,.14))
    mesh.box((0,1.03,2.99),(2.85,1.1,.25))
    mesh.box((0,1.09,.10),(2.38,.96,.23))
    mesh.box((0,1.08,-2.7),(2.85,1.4,.36))
    for x in (-.78,.78):
        mesh.cylinder((x,1.1,-2.53),(x,1.1,-1.15),.22,12)
        mesh.cylinder((x,1.1,-1.15),(x,1.1,-.015),.12,10)
        mesh.beam((x,.55,-2.55),(x,.55,-.9),.14)
    mesh.box((1.95,.65,-1.85),(.8,1.3,1.2))
    mesh.cylinder((1.95,1.3,-1.85),(1.95,1.68,-1.85),.23,10)
    mesh.beam((1.95,.5,-1.3),(1.4,.5,-.95),.07)
    mesh.box((-1.8,1.02,-1.35),(.48,.42,.38),rotation(15,0,0))
    mesh.box((-1.8,.43,-1.35),(.12,.86,.12))
    for x in (-1.9,-1.75):
        mesh.cylinder((x,1.12,-1.12),(x,1.20,-1.10),.035,8)
    return mesh


def barrel():
    mesh=Mesh()
    mesh.cylinder((0,.025,0),(0,.88,0),.285,12)
    for y in (.045,.27,.64,.87):
        mesh.cylinder((0,y-.025,0),(0,y+.025,0),.307,12)
    mesh.cylinder((.12,.88,.06),(.12,.905,.06),.045,8)
    return mesh


def barrels():
    mesh=Mesh(); single=barrel()
    for x,z in [(-.34,-.32),(.34,-.32),(-.34,.32),(.34,.32)]:
        mesh.merge(single,(x,0,z))
    sideways=Mesh(); sideways.merge(single,rot=rotation(90,0,15)); sideways.ground()
    mesh.merge(sideways,(1.05,0,.05))
    return mesh


def bus():
    mesh=Mesh()
    # Hollow window band framed by pillars; no coloured glass required.
    mesh.box((0,.92,0),(2.45,.76,9.0))
    mesh.box((0,1.35,0),(2.45,.1,9.0))
    mesh.box((0,2.94,0),(2.52,.20,9.08))
    for x in (-1.17,1.17):
        mesh.box((x,2.77,0),(.13,.20,8.95))
        mesh.box((x,1.60,0),(.13,.16,8.95))
        for z in np.linspace(-4.35,4.35,10):
            mesh.box((x,2.17,z),(.13,1.2,.12))
    for z in (-4.43,4.43):
        mesh.box((0,1.54,z),(2.34,.35,.14))
        for x in (-1.15,0,1.15):
            mesh.box((x,2.20,z),(.1,1.1,.14))
        mesh.box((0,2.77,z),(2.4,.18,.14))
        mesh.box((0,.75,z*1.04),(2.52,.2,.18))
        for x in (-.9,.9):
            mesh.cylinder((x,1.13,z),(x,1.13,z+(.10 if z>0 else -.10)),.11,8)
    # Road wheels on both sides, simple flat hubs.
    for z in (-2.8,2.8):
        for sign in (-1,1):
            mesh.cylinder((sign*1.05,.5,z),(sign*1.35,.5,z),.5,12)
            mesh.cylinder((sign*1.35,.5,z),(sign*1.37,.5,z),.24,10)
    # Sparse benches visible through open windows make the upright shell readable.
    for z in (-3.4,-2.3,-1.2,-.1,1.0,2.1):
        for x in (-.73,.73):
            mesh.box((x,1.65,z),(.66,.15,.55))
            mesh.box((x,1.98,z-.23),(.66,.55,.12))
    mesh.box((0,1.8,3.7),(2.05,.3,.46))
    # Door outline and step on one side, all still the same object.
    mesh.box((1.26,1.05,3.55),(.07,.72,1.1))
    mesh.box((1.32,.54,3.55),(.28,.12,1.1))
    mesh.box((0,3.08,-.7),(1.3,.16,1.5))
    return mesh


def workshop():
    mesh=Mesh()
    # 8 x 6 m shed; open entrance 5 m wide and 3.4 m tall, facing +Z.
    mesh.box((0,.06,0),(8,.12,6))
    for x in (-3.9,3.9):
        mesh.box((x,2.1,0),(.2,4.2,6))
    mesh.box((0,2.1,-2.9),(8,4.2,.2))
    for x in (-3.25,3.25):
        mesh.box((x,2.1,2.9),(1.5,4.2,.2))
    mesh.box((0,3.86,2.9),(5,.68,.2))
    # Roof overhang and simple ribs; usable interior left clear.
    mesh.box((0,4.28,0),(8.45,.16,6.5))
    for x in np.linspace(-4,4,17):
        mesh.box((x,4.385,0),(.045,.05,6.4))
    for x in (-2.56,2.56):
        mesh.box((x,1.82,2.77),(.12,3.4,.15))
    mesh.cylinder((-2.65,3.76,3.08),(2.65,3.76,3.08),.20,12)
    # Small entrance ramp joins the floor slab without a step.
    mesh.add([(-2.5,0,3),(2.5,0,3),(-2.5,0,3.7),(2.5,0,3.7),(-2.5,.12,3),(2.5,.12,3)],
             [(0,1,3,2),(0,4,5,1),(4,2,3,5),(0,2,4),(1,5,3)],True)
    return mesh


if __name__=='__main__':
    models=[('car_rack_loaded_6',rack()),('car_rack_empty',rack(False)),('scrap_hydraulic_press',press()),('bus_upright',bus()),('barrel_single',barrel()),('barrel_cluster_5',barrels()),('workshop_open',workshop())]
    manifest=json.loads((ROOT/'manifest.json').read_text())
    names={name for name,_ in models}; manifest=[i for i in manifest if i['asset'] not in names]
    for name,mesh in models:
        mesh.ground(); points=np.array(mesh.v)
        assert np.isfinite(points).all()
        for f in mesh.f:
            p=points[list(f)]
            assert np.linalg.norm(np.cross(p[1]-p[0],p[2]-p[0]))>1e-10
        lines=['# Metres; Y up; one object; uncoloured; static prop',f'o {name}','s off']
        lines+=['v '+' '.join(f'{v:.6f}' for v in p) for p in points]
        lines+=['f '+' '.join(str(i+1) for i in f) for f in mesh.f]
        (ROOT/f'{name}.obj').write_text('\n'.join(lines)+'\n')
        item={'asset':name,'objects':1,'triangles':len(mesh.f),'dimensions_xyz_m':np.round(np.ptp(points,axis=0),3).tolist()}
        if name=='car_rack_loaded_6': item['car_count']=6
        manifest.append(item); print(item)
        render(mesh).save(ROOT/f'{name}.png')
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    sheet=Image.new('RGB',(1500,1920),(239,239,239)); draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',26)
    title=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf',36)
    draw.text((750,44),'JUNKYARD / RACKS & WORKSHOP',font=title,fill='#303030',anchor='mm')
    labels=['Loaded rack / six cars','Empty rack','Hydraulic scrap press','Upright bus','Single barrel','Five-barrel cluster','Workshop / wide open entrance']
    for i,((name,mesh),label) in enumerate(zip(models,labels)):
        col=i%2; row=i//2
        sheet.paste(render(mesh,(720,375)),(15+750*col,100+450*row))
        draw.text((375+750*col,494+450*row),label,font=font,fill='#303030',anchor='mm')
    draw.text((1125,1570),'One object per asset',font=font,fill='#555555',anchor='mm')
    draw.text((1125,1620),'Uncoloured / metres',font=font,fill='#555555',anchor='mm')
    sheet.save(ROOT/'landmarks_preview.png')
    for filename,items in [('junkyard_uncoloured_props.zip',manifest),('junkyard_landmarks.zip',[i for i in manifest if i['asset'] in names])]:
        with zipfile.ZipFile(ROOT/filename,'w',zipfile.ZIP_DEFLATED) as archive:
            for item in items: archive.write(ROOT/(item['asset']+'.obj'),item['asset']+'.obj')
            for name in ['README.md','asset_checklist.md','junkyard_ideas.md','manifest.json','landmarks_preview.png']:
                archive.write(ROOT/name,name)
            if filename=='junkyard_uncoloured_props.zip':
                for name in ['preview.png','expansion_preview.png']: archive.write(ROOT/name,name)
