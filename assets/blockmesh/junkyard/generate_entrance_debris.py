"""Very simple fallen entrance props; no small rubble or textures."""
import json
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from generate import ROOT, Mesh, rotation, render
from generate_expansion import grounded


def concrete_block(width, height, depth):
    mesh = Mesh()
    # Only eight corners: a slightly broken silhouette, no surface detailing.
    mesh.add([(-width/2,0,-depth/2),(width/2,0,-depth/2),
              (width/2,0,depth/2),(-width/2,0,depth/2),
              (-width*.43,height,-depth*.45),(width*.39,height*.84,-depth*.48),
              (width*.46,height*.78,depth*.41),(-width*.38,height*.92,depth*.45)],
             [(0,1,2,3),(4,5,6,7),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],True)
    return mesh


def fallen_gate():
    mesh = Mesh()
    # Low bent frame lies along the ground: X across, Z along its fallen height.
    def p(x, z):
        return (x, .09 + .17*(1-abs(x)/1.8), z)
    for z in (-.95,.95):
        mesh.beam(p(-1.8,z),p(0,z),.16)
        mesh.beam(p(0,z),p(1.8,z),.16)
    for x in (-1.8,1.8):
        mesh.beam(p(x,-.95),p(x,.95),.16)
    for x in (-1.25,-.62,0,.62,1.25):
        mesh.beam(p(x,-.91),p(x,.91),.10)
    # Single bent diagonal brace, sitting against the bars.
    mesh.beam((-1.72,.18,-.84),(0,.35,0),.105)
    mesh.beam((0,.35,0),(1.72,.18,.84),.105)
    for z in (-.65,.65):
        mesh.box((-1.91,.11,z),(.22,.14,.22))
    grounded(mesh,concrete_block(.70,.48,.66),2.38,.64,rotation(0,12,0))
    grounded(mesh,concrete_block(.63,.32,.52),2.38,-.45,rotation(0,-22,0))
    return mesh


def fallen_sign():
    mesh = Mesh()
    sign = Mesh()
    # Blank two-piece board: one broad face and a simply folded end.
    sign.box((-.20,0,0),(2.70,.11,1.25))
    sign.box((1.33,.048,0),(.38,.11,1.25),rotation(0,0,14))
    # The two broken legs remain attached and extend toward the viewer.
    for x,length in ((-.95,1.0),(.85,.67)):
        sign.box((x,-.10,.54+length/2),(.13,.15,length+.2))
    grounded(mesh,sign,0,0,rotation(-7,0,0))
    # Two big, deliberately crude blocks; no chips or pebbles.
    grounded(mesh,concrete_block(.64,.32,.55),-.98,1.62,rotation(0,10,0))
    grounded(mesh,concrete_block(.50,.27,.47),.90,1.36,rotation(0,-18,0))
    return mesh


if __name__ == '__main__':
    models=[('fallen_gate_simple',fallen_gate()),('fallen_signboard_simple',fallen_sign())]
    manifest=json.loads((ROOT/'manifest.json').read_text())
    names={n for n,_ in models}; manifest=[i for i in manifest if i['asset'] not in names]
    for name,mesh in models:
        mesh.ground(); points=np.array(mesh.v)
        assert np.isfinite(points).all()
        for face in mesh.f:
            p=points[list(face)]
            assert np.linalg.norm(np.cross(p[1]-p[0],p[2]-p[0]))>1e-10
        lines=['# Metres; Y up; single mesh; uncoloured; no small rubble',f'o {name}','s off']
        lines+=['v '+' '.join(f'{v:.6f}' for v in p) for p in points]
        lines+=['f '+' '.join(str(i+1) for i in f) for f in mesh.f]
        (ROOT/f'{name}.obj').write_text('\n'.join(lines)+'\n')
        item={'asset':name,'objects':1,'triangles':len(mesh.f),'concrete_blocks':2,'dimensions_xyz_m':np.round(np.ptp(points,axis=0),3).tolist()}
        manifest.append(item); print(item)
        render(mesh).save(ROOT/f'{name}.png')
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    sheet=Image.new('RGB',(1500,610),(239,239,239)); draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',26)
    title=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf',36)
    draw.text((750,44),'JUNKYARD / SIMPLE ENTRANCE DEBRIS',font=title,fill='#303030',anchor='mm')
    for i,((name,mesh),label) in enumerate(zip(models,['Fallen gate / bent frame','Fallen sign / broken legs'])):
        sheet.paste(render(mesh,(720,375)),(15+750*i,100))
        draw.text((375+750*i,495),label,font=font,fill='#303030',anchor='mm')
    draw.text((750,560),'Two chunky blocks per prop. No small rubble. One object each.',font=font,fill='#555555',anchor='mm')
    sheet.save(ROOT/'entrance_debris_preview.png')
    for filename,items in [('junkyard_uncoloured_props.zip',manifest),('junkyard_entrance_debris.zip',[i for i in manifest if i['asset'] in names])]:
        with zipfile.ZipFile(ROOT/filename,'w',zipfile.ZIP_DEFLATED) as archive:
            for item in items: archive.write(ROOT/(item['asset']+'.obj'),item['asset']+'.obj')
            for name in ['README.md','manifest.json','entrance_debris_preview.png']: archive.write(ROOT/name,name)
            if filename=='junkyard_uncoloured_props.zip':
                for name in ['asset_checklist.md','junkyard_ideas.md','preview.png','expansion_preview.png','landmarks_preview.png','vehicles_preview.png','small_salvage_preview.png']: archive.write(ROOT/name,name)
