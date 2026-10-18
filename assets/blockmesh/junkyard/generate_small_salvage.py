"""Small grounded clutter, six-piece stacks and visibly stripped cars."""
import json
import math
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from generate import ROOT, Mesh, rotation, tire, engine, render
from generate_expansion import grounded
from generate_landmarks import barrel
from generate_vehicles import cabin


def pipe():
    mesh=Mesh(); n=16
    # Hollow sleeve with outward outer wall, inward inner wall and thick rims.
    vertices=[(r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z)
              for z,r in [(-1.25,.6),(1.25,.6),(-1.25,.47),(1.25,.47)] for i in range(n)]
    faces=[]
    for i in range(n):
        j=(i+1)%n
        faces.extend([(i,j,n+j,n+i),(2*n+i,3*n+i,3*n+j,2*n+j),
                      (i,2*n+i,2*n+j,j),(n+i,n+j,3*n+j,3*n+i)])
    mesh.add(vertices,faces)
    return mesh


def pyramid(piece,radius):
    mesh=Mesh()
    for row,count in enumerate((3,2,1)):
        for i in range(count):
            mesh.merge(piece,((i-(count-1)/2)*radius*2,radius+row*math.sqrt(3)*radius,0))
    return mesh


def barrel_pyramid():
    piece=Mesh(); piece.merge(barrel(),rot=rotation(90,0,0))
    # Centre its length; rolling rings determine contact radius.
    p=np.array(piece.v); p[:,2]-=(p[:,2].min()+p[:,2].max())/2
    piece.v=p.tolist()
    mesh=pyramid(piece,.307)
    # Grounded chocks stop the bottom barrels rolling outward.
    for x in (-.99,.99):
        mesh.box((x,.06,0),(.16,.12,.55))
    return mesh


def small_scrap(garbage=False):
    mesh=Mesh()
    if not garbage:
        grounded(mesh,engine(),-.20,0,rotation(0,25,0))
        for x,z,yaw in [(.35,.27,35),(-.45,.40,-30),(.30,-.4,65),(-.55,-.27,15)]:
            part=Mesh(); part.box((0,0,0),(.35,.045,.28))
            part.box((.2,.045,0),(.12,.045,.28),rotation(0,0,35))
            grounded(mesh,part,x,z,rotation(0,yaw,0))
        for x,z in [(.5,.02),(-.2,.6)]:
            part=Mesh(); part.cylinder((0,0,-.24),(0,0,.24),.07,8)
            grounded(mesh,part,x,z,rotation(0,20,0))
    else:
        # Squashed boxes with broken/open tops, plus low ground-level rubbish.
        for x,z,size in [(-.25,-.15,.42),(.3,.12,.34),(-.22,.38,.27)]:
            mesh.box((x,.025,z),(size,.05,size))
            for side in (-1,1):
                mesh.box((x+side*size/2,size*.35,z),(.035,size*.7,size))
                mesh.box((x,size*.35,z+side*size/2),(size,size*.7,.035))
            mesh.box((x+size*.6,size*.65,z),(size*.3,.035,size),rotation(0,0,-25))
        for i,(x,z) in enumerate([(-.6,.1),(.6,-.15),(.15,-.5),(-.4,-.45),(.4,.55)]):
            mesh.cylinder((x,.065,z-.10),(x,.065,z+.10),.065,8)
            part=Mesh(); part.box((0,0,0),(.23,.025,.19))
            grounded(mesh,part,x+.07,z+.13,rotation(0,i*27,0))
    return mesh


def wreck(roofless=False):
    mesh=Mesh()
    # Floor plus separate body panels leave actual holes for missing parts.
    mesh.box((0,.37,0),(1.65,.16,4.05))
    mesh.box((0,.63,-1.54),(1.72,.42,1.0))
    for side in (-1,1):
        mesh.box((side*.81,.54,1.48),(.10,.30,1.08))
        mesh.box((side*.81,.49,-.1),(.10,.14,2.05))
        if side<0:
            mesh.box((side*.81,.73,-.05),(.10,.44,1.75))
    # Missing right door; seats and low floor are exposed through the opening.
    if not roofless:
        cabin(mesh,.79,.93,1.42,-1.05,1.04,-.70,.55,(-.35,))
    else:
        for side in (-1,1):
            mesh.beam((side*.78,.89,1.04),(side*.65,1.25,.73),.075)
            mesh.beam((side*.79,.89,-1),(side*.74,1.04,-.93),.07)
        mesh.beam((-.65,1.25,.73),(.65,1.25,.73),.075)
    for x in (-.4,.4):
        mesh.box((x,.66,-.10),(.52,.15,.48))
        mesh.box((x,.9,-.30),(.52,.4,.10))
    # Hood is absent on the first wreck, showing the engine and chassis rails.
    if not roofless:
        e=engine(); e.v=(np.array(e.v)*.8).tolist()
        mesh.merge(e,(0,.45,1.45))
    else:
        mesh.box((0,.87,1.47),(1.55,.08,1.02),rotation(0,0,-7))
    mesh.box((0,.51,-2.05),(1.76,.13,.13))
    mesh.box((-.33,.40,2.08),(1.20,.13,.13),rotation(0,13,-9))
    missing={(1,1)} if not roofless else {(1,1),(1,-1)}
    for side in (-1,1):
        for end in (-1,1):
            z=end*1.31
            if (side,end) in missing:
                mesh.cylinder((side*.76,.34,z),(side*.91,.34,z),.10,8)
                # Blocks visibly support the chassis at missing wheels.
                mesh.box((side*.57,.13,z),(.30,.26,.38))
                continue
            mesh.cylinder((side*.75,.34,z),(side*.96,.34,z),.34,12)
            mesh.cylinder((side*.96,.34,z),(side*.975,.34,z),.16,10)
    # Detached wheels and door stay grounded and are joined into the same object.
    grounded(mesh,tire(),1.45,.75,rotation(0,0,0))
    if roofless:
        grounded(mesh,tire(),1.5,-.85,rotation(0,0,0))
        panel=Mesh(); panel.box((0,0,0),(1.25,.07,.90))
        grounded(mesh,panel,-1.35,-.65,rotation(0,30,0))
    door=Mesh(); door.box((0,0,0),(.65,.07,.90))
    grounded(mesh,door,1.40,-.1,rotation(0,15,0))
    return mesh


if __name__=='__main__':
    models=[('playground_pipe_stack_6',pyramid(pipe(),.6)),('barrel_stack_6_horizontal',barrel_pyramid()),('scrap_heap_small',small_scrap()),('garbage_heap_small',small_scrap(True)),('car_wreck_missing_hood',wreck()),('car_wreck_stripped_roof',wreck(True))]
    manifest=json.loads((ROOT/'manifest.json').read_text()); names={n for n,_ in models}
    manifest=[i for i in manifest if i['asset'] not in names]
    for name,mesh in models:
        mesh.ground(); points=np.array(mesh.v)
        assert np.isfinite(points).all()
        for f in mesh.f:
            p=points[list(f)]; assert np.linalg.norm(np.cross(p[1]-p[0],p[2]-p[0]))>1e-10
        lines=['# Metres; Y up; one uncoloured mesh',f'o {name}','s off']
        lines+=['v '+' '.join(f'{v:.6f}' for v in p) for p in points]
        lines+=['f '+' '.join(str(i+1) for i in f) for f in mesh.f]
        (ROOT/f'{name}.obj').write_text('\n'.join(lines)+'\n')
        item={'asset':name,'objects':1,'triangles':len(mesh.f),'dimensions_xyz_m':np.round(np.ptp(points,axis=0),3).tolist()}
        manifest.append(item); print(item)
        render(mesh).save(ROOT/f'{name}.png')
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    sheet=Image.new('RGB',(1500,1480),(239,239,239)); draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',26)
    title=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf',36)
    draw.text((750,44),'JUNKYARD / SMALL SALVAGE',font=title,fill='#303030',anchor='mm')
    labels=['Six hollow pipes / 3-2-1 stack','Six horizontal barrels / 3-2-1 stack','Small metal scrap heap','Small rubbish heap','Missing hood, door and wheel','Missing roof, door and two wheels']
    for i,((name,mesh),label) in enumerate(zip(models,labels)):
        col=i%2; row=i//2
        sheet.paste(render(mesh,(720,375)),(15+750*col,100+450*row))
        draw.text((375+750*col,494+450*row),label,font=font,fill='#303030',anchor='mm')
    sheet.save(ROOT/'small_salvage_preview.png')
    for filename,items in [('junkyard_uncoloured_props.zip',manifest),('junkyard_small_salvage.zip',[i for i in manifest if i['asset'] in names])]:
        with zipfile.ZipFile(ROOT/filename,'w',zipfile.ZIP_DEFLATED) as archive:
            for item in items: archive.write(ROOT/(item['asset']+'.obj'),item['asset']+'.obj')
            for name in ['README.md','manifest.json','small_salvage_preview.png']: archive.write(ROOT/name,name)
            if filename=='junkyard_uncoloured_props.zip':
                for name in ['asset_checklist.md','junkyard_ideas.md','preview.png','expansion_preview.png','landmarks_preview.png','vehicles_preview.png']: archive.write(ROOT/name,name)
