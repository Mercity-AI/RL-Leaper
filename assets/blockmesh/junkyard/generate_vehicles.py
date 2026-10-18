"""Four additional static, single-object, uncoloured vehicles."""
import json
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from generate import ROOT, Mesh, rotation, tire, render


def road_wheels(mesh, half_width, wheelbase, radius=.34):
    for z in (-wheelbase/2,wheelbase/2):
        for side in (-1,1):
            mesh.cylinder((side*(half_width-.12),radius,z),
                          (side*(half_width+.1),radius,z),radius,12)
            mesh.cylinder((side*(half_width+.10),radius,z),
                          (side*(half_width+.12),radius,z),radius*.48,10)


def cabin(mesh, width, base_y, roof_y, rear, front, roof_rear, roof_front, pillars=()):
    # Real open window frames, so the silhouette reads without dark materials.
    for side in (-1,1):
        x=side*width; rx=side*(width-.10)
        mesh.beam((x,base_y,rear),(rx,roof_y,roof_rear),.085)
        mesh.beam((x,base_y,front),(rx,roof_y,roof_front),.085)
        mesh.beam((x,base_y,rear),(x,base_y,front),.075)
        mesh.beam((rx,roof_y,roof_rear),(rx,roof_y,roof_front),.08)
        for z in pillars:
            mesh.beam((x,base_y,z),(rx,roof_y,z),.075)
    mesh.box((0,roof_y,(roof_rear+roof_front)/2),(2*width-.08,.1,roof_front-roof_rear+.08))
    for z in (rear,front):
        mesh.box((0,base_y,z),(width*2,.085,.085))


def vehicle(kind):
    mesh=Mesh()
    van=kind=='van'; wagon=kind=='wagon'
    length=5.2 if van else (4.65 if wagon else 4.25)
    width=1.02 if van else .88
    radius=.39 if van else .34
    mesh.box((0,.61,0),(2*width,.55,length))
    if van:
        # Enclosed cargo box behind the driver's cab.
        mesh.box((0,1.53,-.83),(2.02,1.31,3.47))
        cabin(mesh,.94,.97,2.20,.86,2.34,.86,1.91)
        mesh.box((0,.94,2.37),(2.02,.20,.45))
        mesh.box((0,2.2,-.18),(2.07,.12,4.98))
        # Rear split doors and sliding cargo door border, raised just off walls.
        for x in (-.5,.5):
            mesh.box((x,1.51,-2.613),(.95,1.28,.03))
            mesh.box((x*.25,1.48,-2.64),(.045,.19,.03))
        mesh.box((1.025,1.46,-.35),(.035,1.12,1.7))
        mesh.box((1.054,1.54,.28),(.045,.045,.23))
    else:
        roof_y=1.53 if wagon else 1.29
        rear=-2.05 if wagon else -1.1
        front=1.04
        roof_rear=-1.90 if wagon else -.60
        roof_front=.59 if wagon else .39
        cabin(mesh,.81,.93,roof_y,rear,front,roof_rear,roof_front,(-.35,))
        mesh.box((0,.92,(front+length/2)/2),(1.75,.14,length/2-front))
        if not wagon:
            mesh.box((0,.90,(-length/2+rear)/2),(1.75,.12,length/2+rear))
        if wagon:
            for x in (-.56,.56):
                mesh.box((x,roof_y+.13,-.6),(.065,.07,2.5))
        # Simple seats below the open window band.
        for z in (-.55,.45):
            for x in (-.40,.40):
                mesh.box((x,.98,z),(.52,.12,.46))
                mesh.box((x,1.14,z-.18),(.52,.32,.1))
    road_wheels(mesh,width,3.15 if van else (2.85 if wagon else 2.65),radius)
    for z in (-length/2,length/2):
        mesh.box((0,.52,z),(2*width+.08,.17,.14))
        for x in (-width*.72,width*.72):
            mesh.box((x,.80,z),(.30,.14,.07))
    mesh.box((0,.72,length/2+.045),(.67,.17,.045))
    for x in (-width*1.1,width*1.1):
        mesh.beam((x*.89,1.04,1.17),(x,1.08,1.17),.055)
        mesh.box((x,1.10,1.17),(.14,.12,.20))
    return mesh


def motorcycle():
    mesh=Mesh()
    # Tires have an actual open centre, slim tread and simple radial spokes.
    for z in (-.73,.77):
        wheel=tire()
        wheel.v=(np.array(wheel.v)*[.94,.58,.94]).tolist()
        mesh.merge(wheel,(0,.329,z),rotation(0,0,90))
        mesh.cylinder((-.10,.329,z),(.10,.329,z),.085,10)
        for angle in np.linspace(0,2*np.pi,8,endpoint=False):
            mesh.beam((0,.329,z),(0,.329+.19*np.cos(angle),z+.19*np.sin(angle)),.025)
    for side in (-1,1):
        x=side*.105
        for a,b in [((x,.329,-.73),(x,.52,-.10)),((x,.52,-.10),(x,.92,.35)),((x,.92,.35),(x,.91,-.4)),((x,.91,-.4),(x,.329,-.73)),((x,.91,-.4),(x,.52,-.10))]:
            mesh.beam(a,b,.055)
        mesh.cylinder((x,.98,.49),(x,.329,.77),.035,8)
        mesh.cylinder((x,.82,-.34),(x,.329,-.73),.048,8)
    mesh.box((0,.62,-.02),(.32,.28,.35))
    for y in (.57,.63,.69):
        mesh.box((0,y,-.02),(.37,.025,.37))
    mesh.box((0,.87,.17),(.37,.26,.48),rotation(-12,0,0))
    mesh.box((0,.97,-.36),(.36,.10,.55))
    mesh.beam((0,.99,.47),(0,1.17,.40),.055)
    mesh.beam((-.38,1.17,.40),(.38,1.17,.40),.04)
    for side in (-1,1):
        mesh.cylinder((side*.28,1.17,.40),(side*.40,1.17,.40),.04,8)
    mesh.cylinder((0,.98,.55),(0,.98,.68),.105,12)
    mesh.box((0,.86,-.74),(.22,.12,.08))
    mesh.cylinder((.21,.40,-.72),(.21,.40,-.06),.065,8)
    # Centre stand touches the ground: upright static prop, ready to duplicate.
    for x in (-.20,.20):
        mesh.beam((0,.50,-.20),(x,0,-.32),.035)
    return mesh


if __name__=='__main__':
    models=[('car_compact_coupe',vehicle('coupe')),('car_station_wagon',vehicle('wagon')),('van_panel',vehicle('van')),('motorcycle_single',motorcycle())]
    manifest=json.loads((ROOT/'manifest.json').read_text())
    names={name for name,_ in models}; manifest=[i for i in manifest if i['asset'] not in names]
    for name,mesh in models:
        mesh.ground(); points=np.array(mesh.v)
        assert np.isfinite(points).all()
        for f in mesh.f:
            p=points[list(f)]
            assert np.linalg.norm(np.cross(p[1]-p[0],p[2]-p[0]))>1e-10
        lines=['# Metres; Y up; +Z front; one mesh; no materials',f'o {name}','s off']
        lines+=['v '+' '.join(f'{v:.6f}' for v in p) for p in points]
        lines+=['f '+' '.join(str(i+1) for i in f) for f in mesh.f]
        (ROOT/f'{name}.obj').write_text('\n'.join(lines)+'\n')
        item={'asset':name,'objects':1,'triangles':len(mesh.f),'dimensions_xyz_m':np.round(np.ptp(points,axis=0),3).tolist()}
        manifest.append(item); print(item)
        render(mesh).save(ROOT/f'{name}.png')
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    sheet=Image.new('RGB',(1500,1030),(239,239,239)); draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',26)
    title=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf',36)
    draw.text((750,44),'JUNKYARD / MORE VEHICLES',font=title,fill='#303030',anchor='mm')
    for i,((name,mesh),label) in enumerate(zip(models,['Compact coupe','Station wagon','Panel van','Motorcycle'])):
        col=i%2; row=i//2
        sheet.paste(render(mesh,(720,375)),(15+750*col,100+450*row))
        draw.text((375+750*col,494+450*row),label,font=font,fill='#303030',anchor='mm')
    sheet.save(ROOT/'vehicles_preview.png')
    for filename,items in [('junkyard_uncoloured_props.zip',manifest),('junkyard_extra_vehicles.zip',[i for i in manifest if i['asset'] in names])]:
        with zipfile.ZipFile(ROOT/filename,'w',zipfile.ZIP_DEFLATED) as archive:
            for item in items: archive.write(ROOT/(item['asset']+'.obj'),item['asset']+'.obj')
            for name in ['README.md','manifest.json','vehicles_preview.png']: archive.write(ROOT/name,name)
            if filename=='junkyard_uncoloured_props.zip':
                for name in ['asset_checklist.md','junkyard_ideas.md','preview.png','expansion_preview.png','landmarks_preview.png']: archive.write(ROOT/name,name)
