"""Additional grounded, single-object props. Run after generate.py."""
import json
import math
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from generate import ROOT, Mesh, tire, scrap, rotation, render


def tire_stack_heap(counts, layout):
    mesh = Mesh()
    for (x, z), count in zip(layout, counts):
        for level in range(count):
            # Flat sidewalls stay in contact through every stack.
            mesh.merge(tire(), (x, .12 + .24 * level, z), rotation(0, level * 19 + x * 31, 0))
    assert sum(counts) in (20, 25)
    return mesh


def grounded(target, piece, x, z, rot=None):
    points = np.array(piece.v)
    if rot is not None:
        points = points @ rot.T
    points[:, 1] -= points[:, 1].min()
    target.add(points + [x, 0, z], piece.f)


def metal_bundle():
    mesh = Mesh()
    # Grounded skids, then three tiers of horizontal beams with physical contact.
    for z in (-.75, .75):
        mesh.box((0, .09, z), (1.5, .18, .18))
    for level, count in enumerate((6, 5, 4)):
        for i in range(count):
            mesh.box(((i-(count-1)/2)*.22, .25 + level*.14, 0), (.19,.14,2.1-.12*level))
    return mesh


def crushed_shell():
    mesh = Mesh()
    # Broad, closed irregular solid; recognisable compressed car/sheet-metal scrap.
    bottom = [(-.65,0,-.45),(.65,0,-.45),(.65,0,.45),(-.65,0,.45)]
    top = [(-.52,.34,-.38),(.57,.43,-.43),(.49,.30,.40),(-.58,.40,.32)]
    mesh.add(bottom+top,[(0,1,2,3),(4,5,6,7),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],True)
    for z in (-.25,0,.25):
        mesh.box((0,.16,z),(1.34,.075,.065),rotation(0,0,5))
    return mesh


def pipe_bundle():
    mesh = Mesh()
    for x in (-.36,0,.36):
        mesh.cylinder((x,.18,-.85),(x,.18,.85),.18,12)
    for x in (-.18,.18):
        mesh.cylinder((x,.18+math.sqrt(.36**2-.18**2),-.75),
                      (x,.18+math.sqrt(.36**2-.18**2),.75),.18,12)
    return mesh


def large_scrap(base, wide=False):
    mesh = Mesh()
    # Each base cluster already contains ground-supported engines and metal.
    locations = [(-1.15,-.6,20),(1.1,-.4,-35),(0,1.05,110)]
    if wide:
        locations = [(-1.75,-.7,15),(.15,-.9,-20),(1.8,.15,90),(-.4,1.25,140)]
    for x,z,yaw in locations:
        grounded(mesh,base,x,z,rotation(0,yaw,0))
    grounded(mesh,metal_bundle(), -2.2 if wide else -1.6, 1.3, rotation(0,-25,0))
    grounded(mesh,pipe_bundle(), 2.35 if wide else 1.8, -.9, rotation(0,30,0))
    for x,z,yaw in ([(-1.9,-1.7,20),(1.2,1.7,-20)] if wide else [(.1,-1.6,15)]):
        grounded(mesh,crushed_shell(),x,z,rotation(0,yaw,0))
    return mesh


def beam_scrap():
    mesh=Mesh()
    grounded(mesh,metal_bundle(),-.65,0,rotation(0,12,0))
    grounded(mesh,pipe_bundle(),.8,.1,rotation(0,-10,0))
    grounded(mesh,crushed_shell(),.1,-1.5,rotation(0,25,0))
    for x,z,yaw in [(-1.3,1.2,30),(.2,1.4,-15),(1.3,-1.1,50)]:
        panel=Mesh()
        panel.box((0,.035,0),(.65,.07,.6))
        panel.box((.35,.12,0),(.16,.07,.6),rotation(0,0,45))
        grounded(mesh,panel,x,z,rotation(0,yaw,0))
    return mesh


if __name__ == '__main__':
    truck=tire()
    truck.v=(np.array(truck.v)*[1.65,1.6,1.65]).tolist()
    base=scrap()
    models=[
        ('tire_heap_20',tire_stack_heap([4,4,3,3,3,3],[(-.75,-.38),(0,-.38),(.75,-.38),(-.75,.38),(0,.38),(.75,.38)])),
        ('tire_heap_25_mound',tire_stack_heap([2,3,2,3,5,3,2,3,2],[(x,z) for z in (-.73,0,.73) for x in (-.73,0,.73)])),
        ('tire_heap_25_long',tire_stack_heap([3,4,4,3,2,3,3,3],[(x,z) for z in (-.38,.38) for x in (-1.12,-.37,.38,1.13)])),
        ('truck_tire_single',truck),
        ('scrap_heap_large',large_scrap(base)),
        ('scrap_heap_extra_large',large_scrap(base,True)),
        ('scrap_heap_beams_pipes',beam_scrap()),
    ]
    manifest_path=ROOT/'manifest.json'
    manifest=json.loads(manifest_path.read_text())
    new_names={name for name,_ in models}
    manifest=[item for item in manifest if item['asset'] not in new_names]
    for name,mesh in models:
        mesh.ground()
        points=np.array(mesh.v)
        assert np.isfinite(points).all()
        for face in mesh.f:
            p=points[list(face)]
            assert np.linalg.norm(np.cross(p[1]-p[0],p[2]-p[0]))>1e-10
        lines=['# Metres; Y up; one object; no materials',f'o {name}','s off']
        lines+=['v '+' '.join(f'{v:.6f}' for v in p) for p in points]
        lines+=['f '+' '.join(str(i+1) for i in f) for f in mesh.f]
        (ROOT/f'{name}.obj').write_text('\n'.join(lines)+'\n')
        item={'asset':name,'objects':1,'triangles':len(mesh.f),'dimensions_xyz_m':np.round(np.ptp(points,axis=0),3).tolist()}
        if name.startswith('tire_heap_'):
            item['tire_count']=int(name.split('_')[2])
            assert len(mesh.f)==item['tire_count']*192
        manifest.append(item)
        render(mesh).save(ROOT/f'{name}.png')
        print(item)
    manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
    sheet=Image.new('RGB',(1500,1920),(239,239,239)); draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',26)
    title=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf',36)
    draw.text((750,44),'JUNKYARD / LARGER HEAPS',font=title,fill='#303030',anchor='mm')
    labels=['20 tires / compact','25 tires / tall mound','25 tires / long heap','Single truck tire / 1.16 m diameter','Large mixed scrap','Extra-large mixed scrap','Beams, pipes and crushed metal']
    for i,((name,mesh),label) in enumerate(zip(models,labels)):
        col=i%2; row=i//2
        sheet.paste(render(mesh,(720,375)),(15+750*col,100+450*row))
        draw.text((375+750*col,494+450*row),label,font=font,fill='#303030',anchor='mm')
    draw.text((1125,1570),'One object per heap',font=font,fill='#555555',anchor='mm')
    draw.text((1125,1620),'Uncoloured / metres',font=font,fill='#555555',anchor='mm')
    sheet.save(ROOT/'expansion_preview.png')
    with zipfile.ZipFile(ROOT/'junkyard_uncoloured_props.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for item in manifest:
            archive.write(ROOT/(item['asset']+'.obj'),item['asset']+'.obj')
        for name in ['README.md','asset_checklist.md','junkyard_ideas.md','manifest.json','preview.png','expansion_preview.png']:
            archive.write(ROOT/name,name)
