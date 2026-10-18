# Uncoloured junkyard blockmesh props

Thirty-three OBJ assets, each exported as exactly one mesh object. No material files,
assigned colours, textures, or vertex colours. Grey in the previews is lighting
only; your editor supplies its default surface. The preview shows actual meshes.

- `tire_single.obj`: open-centre car tire, 0.70 m diameter, 0.24 m thick,
  lying flat for easy duplication and stacking. No hub or rim.
- `tire_heap_12.obj`: twelve car-sized tires combined into one object.
- `scrap_bin_tall.obj`: tall, open, reinforced scrap container.
- `scrap_skip_long.obj`: longer, lower open skip with splayed walls.
- `scrap_heap_engines.obj`: metal plates, bars, bent panels, pipes and three
  simplified engine/transmission assemblies combined into a single heap.
- `sorting_crane.obj`: static crawler crane with framed cab, two-part boom,
  hydraulic cylinders, hinge pins and an open four-finger scrap grapple.
- `edge_utility_cabinet.obj`: extra cabinet for the small utility/appliance-like
  objects along the reference image's fence. These details are ambiguous in the
  reference, so this is an interpretation rather than an exact recreation.

## Larger heaps expansion

- `tire_heap_20.obj`: twenty tires in six grounded short stacks.
- `tire_heap_25_mound.obj`: twenty-five tires in a broad mound, tallest at centre.
- `tire_heap_25_long.obj`: twenty-five tires in a longer two-row arrangement.
- `truck_tire_single.obj`: larger tire, about 1.16 m diameter and 0.38 m thick.
- `scrap_heap_large.obj`: nine engines with loose metal, beams, pipes and a
  compressed metal block, all combined as one prop.
- `scrap_heap_extra_large.obj`: twelve engines with additional metal and two
  compressed blocks; a wider obstacle for filling larger areas.
- `scrap_heap_beams_pipes.obj`: a lower heap of stacked beams, pipes and panels.

All OBJ files, including `scrap_heap_engines.obj` from the original pack, are
directly in this folder. `expansion_preview.png` shows the seven additions.
`junkyard_ideas.md` covers future crusher, railway and other junkyard props.
Run `generate.py` then `generate_expansion.py` to rebuild the full fourteen-asset
archive. The expansion keeps tire stacks in contact and grounds scrap clusters;
it does not run a rigid-body physics simulation.

## Racks, machinery and workshop

- `car_rack_loaded_6.obj`: three bays, two levels, six cars. Rack and cars are
  one object; tires sit on the two steel runner decks. Approximately 8 m wide.
- `car_rack_empty.obj`: matching empty rack for alternative layouts.
- `scrap_hydraulic_press.obj`: open scrap chamber with a horizontal pusher plate,
  twin hydraulic cylinders and a power unit. Static machine for beside the crane.
- `bus_upright.obj`: approximately 9 m bus, upright for you to rotate/tip. Open
  window frames, simple benches and wheels; no separate materials or glass.
- `barrel_single.obj`: one ordinary metal drum, approximately 0.61 m diameter.
- `barrel_cluster_5.obj`: four standing drums and one resting on its side.
- `workshop_open.obj`: basic 8 x 6 m shed with an empty interior, a roughly
  5 m wide / 3.4 m tall front opening, raised shutter roll, roof and entry ramp.
  Front faces +Z. Entrance is actually open, not a panel drawn onto a wall.

`junkyard_landmarks.zip` contains these seven new assets; the full archive contains
all twenty-one. Run `generate_landmarks.py` after the other two generators to
rebuild the complete pack. Static props have no animation or game collisions.
For a walk-in workshop, avoid a single solid box collider enclosing the building;
the game's collision setup must preserve the entrance and empty interior.

## Additional vehicles

- `car_compact_coupe.obj`: low-roof compact two-door car.
- `car_station_wagon.obj`: longer family car with roof rails.
- `van_panel.obj`: boxy cargo van with a framed cab and closed cargo compartment.
- `motorcycle_single.obj`: motorcycle with open-centre wheels, frame, engine,
  tank, seat, forks, handlebars and a ground-contacting centre stand.

All four are uncoloured single mesh objects, with +Z forward and Y up. Vehicle
window openings are physically open rather than painted glass. They are static
layout props, not rigged vehicles. `junkyard_extra_vehicles.zip` contains these
four; `vehicles_preview.png` shows their geometry at individually fitted scales.
Run `generate_vehicles.py` last to rebuild the complete twenty-five-asset pack.

## Small salvage and wrecks

- `playground_pipe_stack_6.obj`: six large hollow pipe sections, arranged 3-2-1,
  inspired by the requested playground reference. Each pipe is 1.2 m across.
- `barrel_stack_6_horizontal.obj`: six ordinary drums on their sides in the same
  3-2-1 arrangement, with small ground chocks at the outside bottom barrels.
- `scrap_heap_small.obj`: small grounded engine, sheet-metal and pipe cluster.
- `garbage_heap_small.obj`: small broken-box, can and offcut cluster.
- `car_wreck_missing_hood.obj`: missing hood, right door and one wheel; engine
  exposed, detached wheel and door resting beside it, chassis on a support block.
- `car_wreck_stripped_roof.obj`: missing roof, right door and two wheels; supported
  chassis with loose wheels and removed panels resting beside it.

Each complete stack, heap or wreck is one static object, including its loose
parts. No colours or materials. Import the desired OBJ from this folder or use
`junkyard_small_salvage.zip`. These new props have not been placed in Blender.
Run `generate_small_salvage.py` after the previous generators for the complete
thirty-one-asset archive. Earlier generator stages rebuild only their own stage
of the archive; run this last to include all previews and assets.

## Simple fallen entrance props

- `fallen_gate_simple.obj`: fallen barred gate panel with a shallow bend, a single
  diagonal brace, two hinge blocks and two large crude concrete chunks.
- `fallen_signboard_simple.obj`: blank fallen sign with a folded end, two broken
  support legs and two large crude concrete chunks.

No pebbles, crack textures, tiny fragments or lettering. Each whole prop is one
uncoloured object. `junkyard_entrance_debris.zip` includes both, and
`entrance_debris_preview.png` shows their actual geometry. Not placed in Blender.
Run `generate_entrance_debris.py` after all earlier generators to produce the
complete thirty-three-asset archive.

Import the OBJ you want. Units are metres, Y is up, and each origin is at ground
level under the centre of its bounding box. Turn off any importer option that
splits disconnected geometry into separate objects. Each complete prop is one
selectable object, but its geometric pieces overlap; these are not Boolean-unioned
watertight solids. No rig, animation, or collision settings are included.

The crane is posed for level layout, not animated or mechanically simulated.
Assets have not been placed in the game. Object counts, triangle counts and exact
dimensions are in `manifest.json`. Asset previews are independently fitted to
their panels and do not show relative scale.

Run `generate.py` with Python, NumPy and Pillow to rebuild. The generator uses a
fixed seed for repeatable scrap placement and Windows Arial for preview labels.
