# 3D model pipeline

Two layers make up the engine you see:

1. **Generated geometry** (`app/scene3d.js`): every component, built in code from the section profiles.
2. **Authored geometry** that replaces generated components:
   - `app/models/` is the project's own model, built with Blender by
     `tools/blender/build_engine.py` (`npm run model`; needs `pip install bpy`) and committed.
   - `app/assets/` is an optional local override for a model you supply. It is ignored by git.

A replaced component keeps working as that component: clickable, removable, highlighted, moved by
the exploded view, and turning with its spool.

## Surface finishes

`app/surfaces.js` gives every material its wear: cast grain and pitting, paint and chromate
mottling, scratches, oil and dirt blotches that collect underneath, drip streaks, heat
discolouration along the hot section and soot towards the exhaust, plus fine surface relief. The
detail is projected from each object's own coordinates (triplanar), so it needs no UVs and stays put
on rotating spools and opening cowls. Presets (`FINISH`) are chosen per part and per material name;
the authored model's materials get the same treatment on load. Colours and finishes follow the
reference photos: painted blue-grey fan and compressor cases, bare grey castings, gold chromate
accessories, stainless and titanium tubes, white braided looms with red sleeves on red P-clamps,
green primer inside the cowls, and off-white composite annulus fillers between the fan blades.
The turbine cases take on a heat tint that runs straw, bronze, purple and blue along the engine,
desaturated by about half. Nickel alloys oxidise to a duller grey-brown than tempered steel (the
museum's LP turbine case is blue-grey steel), so at full colour they looked copper. The exhaust cone
is a dull grey-brown.

Three more effects come per finish:

- **Edge wear:** where the surface curves sharply (bevelled and machined edges), paint, primer and
  plating rub through to bare metal, and castings show lighter worn edges. The shader finds the
  curvature from how fast the normal changes over distance, and breaks the wear up with the grain and
  blotch layers so it is patchy.
- **Turning marks:** discs, shafts, races and gears carry fine lathe rings round their own axis on
  faces, and round it along their length on cylinders. The axis is the object's local X: the engine
  axis, or a gear's own. The rings fade out before they would shimmer at a distance.
- **Woven fibre:** composite parts show their tows alternating direction cell by cell.

Drip streaks always run with gravity: each projection keeps the texture's down direction along the
engine's.

The detail follows the Quality button. Low draws plain materials; heat tint and soot stay, since they
show temperature. Medium adds grain, mottling, scratches, grime, edge wear, turning marks and weave.
High adds the micro-bump and a 1024-pixel detail texture. Ultra uses a 2048-pixel detail texture with
16x anisotropic filtering, for close-ups. The texture and level are shared uniforms, so switching never
recompiles a shader.

## Decals

The model carries no images: a decal's material is named `dec:<kind>:<text>`, and the app draws its texture
from that name when the model loads (`app/decals.js`). `tools/blender/decals.py` lays each one on its
surface: a small grid ray-cast point by point onto the part, so it follows a cylinder, a casting or a cowl
without floating at the edges. Each decal is named after its part, so it moves, explodes and hides with it.
Cowl decals swing with their door, and decals inside the cutaway sector hide with the casing they sit on.

| Kind | Looks like | Where |
|---|---|---|
| `plate` | etched stainless data plate: title bar, fields, rivets, barcode, handling marks | engine data plate on the fan case (model V2527-A5, type certificates FAA E40NE and EASA IM.E.069, 26,500 lbf); a plate on every accessory and core unit |
| `warn` | safety placard with the signal word and alert symbol | oil tank, IDG, starter and hydraulic pump servicing; ignition high voltage; cowl hold-open rods; reverser deactivation |
| `tape` | fluid-line identification tape (MIL-STD-1247 colour and shape symbol) | wrapped near both ends of every named fuel, oil, hydraulic and pneumatic line, and at intervals along it |
| `sten` | painted stencil lettering with bridges and wear | latches and access doors on the cowls, lift points, grounding stud, forward arrow, fan blade numbers on the spinner fairing (1 to 22, matching the borescope's count) |
| `wire` | white wire-marker sleeve with its wire number | every harness, one number each |
| `tag` | engraved aluminium tag with a lock-wire hole | chip detector, bulkhead panel lines |

Torque-seal stripes are orange paint marks across every tube union nut and on along the tube, as mechanics
mark a tightened joint. They are geometry, not decals. Part and serial numbers on the unit plates are made
up.

The fluid colours follow MIL-STD-1247:

| Line | Colours | Symbol |
|---|---|---|
| Fuel | red | star |
| Oil | yellow | square |
| Hydraulic | blue, yellow, blue | circle |
| Pneumatic | orange and blue | cross |

## Building the project's model

`tools/blender/build_engine.py` runs Blender headless, builds components from the same profiles as
the simulator, and writes `app/models/v2500.glb` plus `app/models/model.json`. Blender is used for
what generated geometry does badly: boolean cuts with capped faces, panel gaps, bevelled edges and
(later) baked textures. Work through `docs/REFERENCE-NOTES.md` to see what is done and what is next.

The external dressing (tubes, harnesses, ducts, hoses) is routed by `tools/blender/pipes.py` and laid
out in `tools/blender/dressing.py`. A route is a list of corners in engine cylindrical terms
`(x, angle, height above a surface)`; it is filleted with concentric bends in an unrolled space and
wrapped back onto the casing, so groups of tubes run parallel and joggle over the fan case ribs.
Block clamps on brackets, B-nuts, braided looms with red identification sleeves, cushioned
P-clamps and connectors are added along the way. Lines inside the cutaway sector are split at its
edge and go to `...B__full` objects; the cut ends get the section material. Dense service lines are
packed into the bays between ribs by a small occupancy map so they do not overlap. Lines for the
core (fuel, servo fuel and air, No. 4 bearing oil, harnesses) end on a bulkhead panel at 6 o'clock beside
the angle gearbox, drop down inside the lower strut of the fan frame (a streamlined fairing behind the
outlet guide vanes that also carries the tower shaft), each at its own station along the chord, then run
aft along the bottom of the core in lanes on two levels and step down to where their core routes begin.

Large ducts get V-band joints with T-bolt latches, bellows convolutions, inline valve bodies with
actuators, band-clamp stand-offs and bolted ports where they leave a casing:

- **Starter air**: from the pylon round the back of the fan case (behind the air-cooled oil cooler),
  forward through the starter air valve, then on to the starter on the gearbox.
- **Nacelle anti-ice**: out of a flanged port on the fan case, forward through the anti-ice valve.
- **Bleed air**: stage 7 and stage 10 ports on the HP compressor case; a check valve on the stage 7
  duct and the HP valve on the stage 10 duct; they join and rise through the upper bifurcation
  through the pressure regulating valve to the pylon.
- **Active clearance control**: four spray rings on the HP turbine case and thirteen on the LP turbine
  case, fed by risers from four axial headers and two collector rings, supplied by the two ACC
  valves. They carry fan air, so they get a plain stainless finish instead of the heat tint.

Tubes that go into a casing end in a cast boss with a hex union rather than stopping in mid-air.

The gearbox accessories and the oil tank are components of their own, built by
`tools/blender/accessories.py`, so each can be picked, read about and removed on its own. Every unit is
modelled in a frame at its mounting pad (local x along the engine axis away from the pad, local z radially
out) from flanges, V-band clamps, ports, plugs, sight glasses and connectors:

- **Front face of the gearbox**: air turbine starter (reduction-gear housing, exhaust screen, inlet to the
  starter duct), dedicated alternator, hydraulic pump (ports where the hydraulic lines leave), lube and
  scavenge pump with its chip detector.
- **Rear face**: IDG (case in two bolted halves, feeder terminal block and cables, sight glass, charge
  filter, disconnect solenoid and reset ring, cooler ports), fuel pump with the fuel metering unit behind it
  (torque motor and position-sensor connectors, shut-off solenoid, servo-fuel manifold and metered-fuel
  outlet where the routed lines start), scavenge filter with its clogging indicator, hand-cranking pad.
- **Gearbox casting**: lay shaft to the angle gearbox at the fan frame, tower-shaft housing, breather.
- **Elsewhere**: the starter air valve in its duct, and the oil tank on saddles on the lower left of the
  fan case (filler, sight glass, quantity transmitter, supply and return ports for the gearbox lines).

One table in `accessories.py` (`LAYOUT`) places every unit; the gearbox casting, the starter duct and the
hydraulic, oil, fuel and cooler lines in `dressing.py` are aimed at the ports it gives, so moving a unit
moves its plumbing. Units are drawn at their real size (IDG about 0.3 m wide, starter about 0.19 m across);
connectors and fittings keep standard sizes. A numeric check keeps every unit inside the closed cowl and
clear of the fan case. In the app each unit has a card with what it does, a live readout from the
simulation, and its controls and faults.

Units on the core, under the core cowl, are built the same way by `tools/blender/core_units.py`: the two
ignition exciters (with high-tension leads to the igniter plugs), the VSV actuator with its crank shaft and
the links to the four unison rings, the fuel distribution valve feeding the manifold pigtails, the two
clearance-control valves with their fan-air inlets and fuel-pressure actuator, the buffer air cooler and
the EGT junction box. `build_mounts` adds the engine mounts, after the Airbus training manual figure (70 power
plant, FWD mount & AFT mount): forward mount on the intermediate case (beam with four pylon bolts and
alignment shear pins, cross beam, two thrust links to lugs on the case, support bearing on the engine's
forward support shaft); aft mount on the turbine exhaust case lugs (pylon aft adaptor on a curved beam, two
side links and a centre link). The upper bifurcation runs aft over the aft mount. Both lie in the cutaway
sector, so they show with it closed.

Twenty-one of the routed lines are exported as parts of their own (`line_<name>` nodes, with a
`line_<name>B__full` node for any length inside the cutaway sector), so each can be picked, removed and
broken (docs/FAILURES.md): P3 servo air, air-cooled oil cooler, nacelle anti-ice, starter air, hydraulic,
fuel supply, fuel-cooled oil cooler, oil pressure sense, IDG cooler, servo fuel, metered fuel, No. 4 bearing
oil, core harnesses A and B, ignition leads A and B, EGT harness, IP and HP bleed ducts, clearance control
ducts and buffer air. `dressing.py` routes them through `L(name)`; everything else stays in the shared
dressing nodes.

### The rest of the engine

`tools/blender/details.py` brings the remaining parts up to the same level as the internals. These were
generated shapes before.

- **Spinner.** A glass-fibre nose cone with a soft rubber tip and the white spiral marking, and a titanium
  rear fairing. The fairing steps over the cone joint and has 18 bolt pockets drilled in it, each with a
  socket-head bolt, plus balance screws round its rear edge.
- **Core cowl (inner fixed structure).** Fixed bands front and rear, and two halves that hinge open with the
  thrust reverser C-ducts. The halves carry:
  - an acoustic skin on the duct side, with panel lines;
  - quilted stainless thermal blankets in the hot zone;
  - frames and edge beams;
  - latches and keepers along the bottom, hinge fittings at the top;
  - an orange fire seal along the forward edge;
  - perforated grilles where the handling bleeds dump into the bypass duct;
  - ram scoops for the clearance-control and buffer-air cooling air.
- **Bifurcations.** Streamlined walls where the two C-ducts meet across the bypass duct, top and bottom.
- **Common nozzle.** The inner core nozzle with a thin trailing edge, and its four struts.
- **Handling bleed valves.** Stage 7A, 7B and 7C, and the stage 10 start bleed. Each has:
  - the valve body on its manifold boss, with bolted flanges;
  - a pneumatic actuator with its muscle-air port, a solenoid with its connector, and a position switch;
  - an outlet duct with a bellows and a V-band, and the silicone seal it makes against the core cowl.
- **Case details.** Stiffening ribs on the turbine cases, and borescope ports with plugs and lock-wire tabs:
  - HP compressor stages 3, 5, 7, 9 and 11;
  - HP turbine stage 1 (two ports) and stage 2;
  - LP turbine stages 3, 5 and 7;
  - the combustor's six.

  Their positions go to `model.json` (`ports`) for the Inspect tab's borescope (docs/BORESCOPE.md).
- **Exhaust case instruments.** Four EGT thermocouples, each with a flange, bolts, a terminal head and posts,
  and a probe down its strut. A harness ring collects them and a lead runs forward to the junction box. There
  are also three P4.9 rakes with three sensing heads each, joined by their manifold.
- **Tubes.**
  - Bearing oil feed and scavenge: down the bottom strut for the front compartment; through the
    combustor's dump gap between two fuel injectors for No. 4, with a streamlined fairing where they cross
    the air; up two exhaust-case struts for No. 5.
  - The ten fuel pigtails from the distribution valve to the manifold, with B-nuts and tees.
  - The fire detection loops on their clips.
- **Liners.** The inlet's perforated acoustic barrel with its splice straps and fastener rows. In the fan
  case, the cream abradable rub strip (with the shallow track the blade tips have worn in it), the
  ice-impact panel and the acoustic panels.

The reverser cascades have cambered turning vanes, 14 per bay. Thin strongbacks every 3° make the fine
rectangular grid that in-flight photos of a deployed reverser show, with heavier frames at the edges of each
of the 18 cascade segments. The strake carries its NO STEP stencil. The generated stand-ins for all of these are
dropped when the model loads.

### Thrust reverser linkage

The Airbus training manual (*Reverser design*) shows 10 blocker doors and 10 rods. The linkage follows the
conventional cascade reverser in patent US 6,764,045, figures 1 and 2.

- **Doors:** each door is hinged at its forward edge to the translating sleeve. Stowed, it lies flush in the
  duct's outer wall. Each door is a curved panel, 0.22 m long and about the duct's height. It tapers so that
  the ten doors close the annulus when they stand radial. It has a perforated acoustic face towards the duct,
  primer-green back stiffeners and a cross rib, two hinge lugs on the sleeve's pin, and a clevis near the
  free edge.
- **Drag links:** each rigid link is faired to a streamlined section, with spherical rod-end eyes, pins and
  nuts. It runs across the fan duct from a clevis on the inner fixed structure to the door's clevis. Stowed,
  it stands nearly radial.
- **Motion:** as the sleeve slides 0.46 m aft, the link pulls the door's free edge down until the door stands
  radial (93°), 21 mm off the inner fixed structure.

The geometry (door 0.22 m, door clevis at 95 % of its length and 20 mm off its face, link pivot at x 2.04 m)
came from a search for a stroke that never swings the door outward. It dips 0.9° at the start, which is
taken as zero, as rigging play would take it up.

The build writes the linkage to the manifest (`reverser`: travel, hinge, door clevis, pivot, link length).
Each frame the app works out the door angle from the rigid link: where the circle round the hinge meets the
circle round the pivot. So the rod never stretches, and each link points from its pivot to its door's eye.

### The accessory drive train

`tools/blender/drivetrain.py` models the drive from the HP spool to every accessory, gear by gear. The layout
follows the Airbus training manual's accessory gearbox figure (ATA 72) and the IAE training notes.

- **Internal gearbox:** a 48-tooth spiral bevel gear splined on the front of the HP stub shaft, held by the
  No. 3 bearing nut. It drives a 30-tooth pinion at right angles, which runs in a duplex ball bearing and a
  roller bearing. Its housing is bolted to the No. 1 bearing support cone, with an oil jet on the mesh. The
  No. 2 bearing and its support moved forward to make room.
- **Tower shaft:** a hollow two-piece shaft, splined at both ends, with a bolted coupling and a steady
  bearing in the intermediate case. It runs down the 6 o'clock strut of the intermediate case, and across the
  bypass duct inside the lower strut of the fan frame, which now starts further forward to hold it.
- **Angle gearbox:** a 31-to-41 spiral bevel pair on the fan case at 6 o'clock, in a cast housing with
  bearings, an aft cover and a chip detector at its low point.
- **Lay shaft:** a quill shaft with a flexible diaphragm coupling, in a flanged housing, into the main
  gearbox's rear face.
- **Main gearbox:** two planes of involute spur gears in a casting split at mid-depth.
  - Rear plane: scavenge pumps, fuel pump, hand-cranking pad and the lay shaft input.
  - Front plane: oil pressure pump, hydraulic pump and dedicated alternator.
  - The starter / IDG gearshaft has a gear in each plane and links them.
  - Every gearshaft has a ball and a roller bearing, lock nuts and its drive coupling.
  - Big gears have webs with lightening holes.
  - The pads sit where their gearshafts are, so the starter and IDG moved 1 degree to share one.

**Idler layout:** `solve_train()` places the idlers between the pads. Every listed pair meshes at exactly the
sum of their pitch radii, and every other pair clears by at least 2.5 modules plus 4 mm. The build checks this
again (`check_train()`) and stops if it fails. The solved layout is stored in `TRAIN`.

**Speeds:** tooth counts give each shaft's speed as a fraction of N2:

| Shaft | Ratio to N2 | At 100 % N2 (14,950 rpm) |
|---|---|---|
| Tower shaft | 1.6 | 23,900 rpm |
| Lay shaft | 1.21 | 18,100 rpm |
| IDG and starter | 0.605 | 9,040 rpm (4,900 at idle: within an A320 IDG's input range) |
| Dedicated alternator | 0.745 | 11,100 rpm |
| Hand-cranking pad | 0.81 | 12,100 rpm |
| Scavenge pumps | 0.50 | 7,500 rpm |
| Fuel pump | 0.47 | 7,000 rpm |
| Oil pressure pump | 0.44 | 6,600 rpm |
| Hydraulic pump | 0.31 | 4,700 rpm |

IAE does not publish pad speeds, so these are estimates sized to the units.

**Gear geometry:**

- **Spur gears:** each tooth has an involute flank (20 degree pressure angle) with a root fillet and a tip
  land, and the tooth ends are chamfered.
- **Bevel gears:** spiral teeth, built from the virtual spur gear on the back cone (Tredgold's
  approximation), scaled towards the apex and twisted along the face.
- **Meshing:** tooth phases are set so every pair interleaves at the line of centres.

**In the app:**

- **Turning:** each rotating assembly is its own node with its origin on its axis. The manifest's `spin` list
  gives its speed ratio to the HP spool. The app turns each one from the HP spool's own angle, so the whole
  train runs at the right relative speeds. When a borescope inspection turns the core by hand, the train turns
  with it.
- **Where to see it:** the main gearbox, angle gearbox and lay shaft housing each have a sectioned cutaway
  version. Open the fan cowls with the cutaway on, or take the gearbox casing off, to watch the gears run.
- **Part cards:** the parts are the internal gearbox, tower shaft, angle gearbox, lay shaft and main gearbox
  gear train. Each card shows live speeds.

### The aircraft (apron scene)

`tools/blender/apron.py` builds the A320 the engine hangs on, for the Apron tab, as `app/models/apron.glb`
(see docs/APRON.md). It has the fuselage with windows, door outlines and belly fairing, the wings with panel
lines, flap-track fairings and wingtip fences, the tail, both gears with twin wheels and chocks, and engine 2.
It is loaded only when the apron is first shown.

### Pylon and wing (engine view)

`tools/blender/airframe.py` builds the pylon and a 5 m slice of the A320 wing above the engine. The wing uses
the same definition as the apron's A320: leading edge swept 27.5°, 5.1° dihedral, and a supercritical
section thinning from 15.5 % to 11.5 %. So the engine view and the apron agree. The slice has slat, flap and
spoiler panel lines, the slat cut either side of the pylon, and the flap-track fairing outboard.

The pylon is a smooth fairing: 70-point sections through about 135 stations.

- **Shape:** the nose rises off the fan cowl. The foot flares out to the cowl hinge lines, so the doors close
  against it. The top fairs into the wing's lower surface. Aft of the reverser the titanium heat shield stands
  6 cm off the hot nozzle, then sweeps up behind it to a tail under the flap.
- **Finish (from on-wing photos):** the forward and aft fairings are satin bare aluminium, the box sides
  between them mid grey, and the heat shield dull titanium with heat and soot staining.
- **Details:** access panels, fastener rows and frame lines, two round access panels, and the pre-cooler
  exhaust louvres high on the side under the wing.

Both the pylon and the wing are hidden in the cutaway, where sectioning them would leave a floating slab.

Closed bodies such as the pylon and wing are checked to face outwards. The renderer's ambient-occlusion pass
draws both sides of every surface, as the main pass does. When the pylon skin faced inwards, the AO pass
dropped it and the mount behind showed through as a ghost.

Services only rise above the cowl inside the pylon, between the hinge lines. The pylon disconnect panels, the
reverser's hydraulic unit, the starter duct and the hydraulic, fuel and harness runs stay under the cowl skin
until they turn up into it.

### Fixes from in-service references

- **Booster case:** it now follows the flow path. It had been drawn as a straight line between its ends at
  x 0.40 and 0.90 m, which cut up to 12 mm inside the flow path, so blade tips and vane platforms came
  through it. A scan of every blade and vane template against the case outer surfaces now finds none
  outside a case.
- **HP compressor variable vanes:** each spindle stands in a bush in its boss on the case, and the levers lie
  just above the case, so the rows read as lever hardware rather than blade tips.
- **Compressor bleed valves** (Airbus TTM *compressor bleed valves* photos): the outlet is a round mouth with
  a domed, screwed plate, ringed by the red-brown silicone fire seal that bears on the core cowl. It had been
  a solid orange disc.
- **Aircraft bleed ducts:** larger, about 92 mm (stage 7) and 80 mm (stage 10).
- **Studio rim light:** near-neutral instead of strong blue, which had tinted every bare metal surface
  blue-grey.

### Fan case dressing

On the core, the 34 packed filler runs from the original build were removed. The packer routed every tube as
circumferential-then-axial steps, which read as zigzags round the back of the engine. The core keeps its named
services: fuel, oil, harnesses A and B, ignition leads, the EGT harness, and the bleed and cooling ducts.

The fan case wiring and tubing is the original packed layout: harness and tube runs between the units'
ports, laid in the bays between the stiffening ribs. Two attempts to rebuild it were reverted:
- a reference-based layout of harness trunks and breakout legs, which came out sparse;
- a generated "busy layer" of irregular runs.

These units were remodelled from the SR Technics booklet photos and kept:

**In-service condition.** The booklet and display-engine photos show cleaned, presentation-condition engines.
In-service and shop photos (engines on transport stands and with the cowls open) are now the reference for
colour and condition:
- the fan case and core cases are bare, dull metal with grime, not blue-grey paint;
- the castings are olive-grey;
- the biggest fan case harness bundles are brown braid.

- **Relay box** (booklet p. 19): a black cover with staggered cooling slots. Channel A and B connectors come
  out of the ends; IGN A, IGN B and P2/T2 heating connectors come out along the bottom edge.
- **Bleed solenoid valves** (booklet p. 31): 7A, 7B, 7C and 10 in a row, with the make-up air valves below.
  Each is an upright brass body on a mounting pad, with a round connector on top and servo-air tubes looping
  from its fittings.
- **Oil tank** (Airbus oil system photo, booklet p. 49): a cast, box-shaped tank with rounded edges,
  stiffening ribs, bolted mounting lugs and a long graduated sight-glass plate (one grid per quart). It
  replaces the earlier welded cylinder in the same space.

### Inside the fan cowl doors

With the cowls open, each door shows its inner structure on the primer-green skin:

- four hat-section frames;
- box edge beams along the hinge and latch edges;
- orange bulb seals fore and aft;
- latch keepers (left door) and hooks (right door) behind the external latches;
- two stowed hold-open rods, telescopic, with red lock collars and stowage clips.

Every piece is tested against the units under the cowl in its final, egg-shaped position. Pieces that would
hit a unit are left out, so the frames come out notched round the units instead of passing through them.

### Blade roots and disc slots

Every rotor template carries its root:

- **Fan:** a dovetail on a shank shaped like the root section, under the annulus fillers.
- **HP turbine:** three-lobe fir-trees with seal wings ("angel wings") fore and aft of the shank.
- **LP turbine:** two-lobe fir-trees.
- **HP compressor:** dovetails in axial slots broached at the root's stagger, as on the drum in the museum
  photos (at most 30°).
- **Booster:** circumferential dovetails in grooves turned in the drum rims.

The disc posts between axial slots are rings of their own. The disc lathes stop at the slot bottoms, so in the
cutaway the slots and roots show end-on at the cut. The fir-tree and dovetail profiles scale with the pitch at
the rim, so posts never get thinner than the slots allow. The HP turbine discs have a cover plate closing the
slots at the front (it feeds them cooling air). The LP turbine seal arms rise from the live rim below the slots
to a land carrying the knife edges.

### Engine internals

`tools/blender/internals.py` models the inside of the engine. The arrangement follows the Airbus training
manual and the SR Technics booklet. Blade and vane counts, chords and angles are estimates sized from
velocity triangles and typical solidity, because IAE does not publish them.

- **Fan.** 22 wide-chord blades, each lofted from 22 airfoil sections (twist about 30 degrees, thick root,
  thin tip, slight lean). Annulus fillers follow the blade roots and carry rubber seal strips. The fan disc
  has a dovetail rim, web and bore. The stub shaft runs back to bearings 1 and 2. The front retaining ring
  carries its 36 + 22 bolts.
- **Booster.** Inner fan vanes, then four rotor and stator stages on the booster drum, each disc with a rim,
  web and bore. The 60 fan outlet guide vanes sit in the bypass duct.
- **Intermediate case.** Ten struts across the swan-neck duct. The hub and a diaphragm carry the No. 1
  bearing support cone. The internal gearbox and the tower shaft run down the bottom strut.
- **HP compressor.** Variable inlet guide vanes and three variable stator rows. Each vane has a trunnion
  button, a spindle through the case and a lever to its unison ring. There are ten rotor stages (titanium
  at the front, nickel at the back), then stators and exit guide vanes. Each disc has a rim, web and bore.
  Drum spacers between the discs carry knife-edge seal teeth. The front and rear cases have bleed
  manifold bulges and bolted flanges.
- **Combustor.**
  - The diffuser case has a pre-diffuser and its struts, injector pads, igniter and borescope bosses.
  - The outer and inner liners are built from overlapping cooled panels: each panel flares out and the
    next starts under its lip, leaving a film-cooling slot.
  - Primary, dilution and igniter holes are drilled with booleans.
  - The dome has a swirler (cup, vanes and ferrule) for each injector, and a hood ahead of it.
  - 20 airblast injectors pass through the hood into their swirlers. They are fed from the manifold ring,
    with clips holding it to the case.
  - Two igniter plugs sit where `dressing.py` routes their leads.
- **HP turbine.**
  - Two stages. The nozzle guide vanes have thermal-barrier-coated platforms.
  - The rotor blades have squealer tips.
  - Outer air seals and vane supports sit in the case.
  - The discs have fir-tree rims, webs and bores. A cover plate sits on disc 1, and an interstage spacer
    carries knife edges that run against a honeycomb seal under the second vanes.
  - Tangential on-board injector (TOBI) ring.
  - HP shaft cone with the compressor discharge seal.
- **LP turbine.**
  - Five stages. The shrouded blades carry two knife edges each, running in honeycomb lands.
  - The vanes have inner shrouds over honeycomb.
  - Bolted discs with seal arms between them.
  - The drive cone runs from disc 6 to the LP shaft, with its own bolt circle.
- **Exhaust case.** 13 struts, a hub with the No. 5 bearing bulkhead, an outer ring with probe bosses, and
  the exhaust plug.
- **Shafts and bearings.**
  - LP shaft with its spline coupling and nut; HP stub shaft.
  - Bearings 1 to 5, each with inner and outer races, balls or rollers, a cage of side rails and bars, and
    a support.
  - Bearing chambers have carbon seals where the shafts leave them.

**Rows and rings.** Every row of identical items (blades, vanes, bolts, swirlers, injectors, rolling
elements) is exported once, as a template of a single item at angle 0. Blade rows come in three levels of
detail, picked by the Quality button:

- **High and Ultra:** dense airfoils (about 1.5 times the section points and four more span stations),
  finer platforms, film-cooling holes along the leading edges and pressure sides of the HP turbine blades
  and vanes, full-resolution squealer tips, spindle nuts on the variable vanes. The blades inside the cases
  cast shadows.
- **Medium (`_mid`):** a lighter airfoil, with no cooling holes and no blade shadows inside the cases.
- **Low (`_lo`):** a plain airfoil.

At High with the cutaway on, the frame is about 14 million triangles counting the shadow and
ambient-occlusion passes; Medium is about 3 million and Low about 1 million. `model.json` lists them under `rings`, each with:

- its part and count
- its kind: rotor, static or vsv (variable stator)
- its spool
- its phase
- how the cutaway treats it: wedge, deep cut, or never cut
- for variable stators, the spindle position

**How the app draws them.** Each ring is one instanced mesh.

- Rotors turn with their spool and drop the instances inside the deep cut. Static rings drop those inside
  the wedge.
- Variable stators turn about their spindles with the simulated stator angle. The inlet guide vanes move
  most; each row behind them moves less.
- The released-blade failures hide instances, as they did with the generated rows.

The vane and blade airfoils follow the sloping annulus walls along the chord. This matters most in the
flared LP turbine and the steep booster inlet.

**Bodies of revolution.** Discs, cases, liners and seals are lathed whole and as a cut copy with section
faces: the wedge for casings, the deep cut for rotor internals. They use up to 144 steps round the axis
(at least 72, more for larger radii), so the facet error stays under about 0.1 mm. Corners of the section
profile are kept sharp. In the app, the static meshes of each part
are merged per material, so hundreds of small bodies cost a handful of draw calls.

**Visibility tiers.** `model.json` `vis` sorts the internals into three tiers:

- what can be seen through the intake or nozzle (always drawn)
- what sits under the core cowl: cases, flanges, VSV levers, injectors. Drawn when the core cowl is off
  or the reverser cowls are open.
- everything inside the cases: drawn only with the cutaway on, the engine exploded or a case removed.

The closed engine therefore draws fewer triangles than it did with the old generated internals.

**Generated stand-ins.** The internals generated in `scene3d.js` are tagged `internal`. They show until
the model loads, then the manifest drops them.

**Download size.** The web host sends the GLB uncompressed. `tools/build-web.mjs` therefore also
publishes a gzipped copy (`manifest.packed`, about 14 MB instead of 35 MB), which the page unpacks with
`DecompressionStream`. The plain file is the fallback. App builds (`--local`) load from local files and
skip the packed copy.

## Nacelle shape

From the Airbus A320 Aircraft Characteristics (airport and maintenance planning) document, figure
2-12-0-991-032 (IAE V2500 major dimensions): 5.25 m long; at the inlet attach flange 2.01 m wide, 0.99 m above
the engine centreline and 1.10 m below it, so the section is egg-shaped, deeper underneath where the gearbox
is; 1.98 / 1.93 m wide at the combustion chamber flanges, 1.64 m at the turbine exhaust case flange and 1.24 m
at the nozzle exit. In the model the inlet lip is at x -0.95 and the nozzle exit at x 4.30 (the fan face is
x 0). `P['nacelle']` is the side profile and `nacelleTop` / `nacelleBot` the top and bottom; the cowls are
built round on the side profile and `egg_deform` reshapes them by angle. The inlet is drooped as in the
figure: its face is tilted 6 deg with the top lip forward (`scarf_deform` shears the lip and inlet cowl,
fading to nothing at the attach flange, and lowers the lip 35 mm), and its highlight is 1.50 m across, with
the throat behind it at 1.41 m opening out to the fan. The lip is a hollow D-section skin (the anti-iced
duct) generated from those radii (`lip_loop`, mirrored by `lipLoop` in app/cutaway.js). Fan cowls open 50 deg and the
reverser halves 45 deg (figures 033 and 034). The bare engine (fig. 031: 3.10 m long, 1.715 m across the fan
case) matches the generated engine.

## Colours

Build scripts give colours as they should look on screen (sRGB); `material()` stores them linear, which is
what glTF and Blender expect. (Storing the sRGB numbers directly made every authored part render one gamma
step too light, so painted cases and tubes looked almost white.) Painted surfaces are not metallic; the
`cast` material is painted blue-grey on the fan case and becomes a duller bare-casting grey on the gearbox
and accessory housings when the app loads it. Stainless tubes are satin (roughness about 0.4), not mirror.

Conventions the loader understands:

- **Node names** are `<component>_<piece>`. A node whose name ends in `__cut` is shown when the
  cutaway is on, and its un-suffixed twin when it is off.
- **Cowl halves**: in the `fancowl` and `cna` components, a node whose name ends in `_L` or `_R`
  (before any `__cut` / `__full`, optionally followed by `_<number>`) belongs to the left or right
  half and turns about that half's hinge beside the pylon when the cowls are opened. A `__full` node
  is shown only with the cutaway off; the build uses this for pieces of the left half that lie inside
  the cutaway sector.
- **Material names** `paint`, `bare`, `lip`, `section` are replaced by the simulator's own materials,
  so authored and generated parts match. Other materials are used as exported.
- **`drop`** in `model.json` lists tags of generated objects to remove (currently `skin`). Without
  it, every generated object of that component is removed.

## Smoke, fire and other effects

**Reverse thrust.** With the reverser deployed, fan air leaves through the cascades, forward and outward at
about 45°. In flow mode, the share of the bypass streamlines that the blocker doors turn out (in proportion
to the door angle) rises through the cascade band and streams forward over the fan cowl, slowing and fading.
The rest still exits the nozzle. There are no cascades over the pylon or the lower bifurcation, so none come
out there.

The efflux itself is air, visible only with moisture in it. It is drawn as a faint additive vapour sheet,
scaled by bypass flow and much stronger in humid air: from about 5 % brightness when dry to about 35 % at
100 % relative humidity. The weather's humidity reaches the scene with the inlet-condensation model.

The `glow` blend mode (light-only puffs, such as the faint exhaust glow) now adds its light one-to-one. It
used three.js additive blending, which multiplies by the source alpha. Glow writes alpha 0, so it had been
adding nothing.

`app/fx.js` draws them; `scene3d.js` places them. A 256 x 256 tileable noise texture is baked at start-up
(smooth fbm, fine fbm, cauliflower "billow" noise, ridged turbulence) and every effect samples it.

- **Billows** are camera-facing quads moved on the CPU, so each puff stays where it was born and smoke can
  be sorted back to front. Smoke is lit: a normal from the puff's shape and noise, the key light (shadowed
  by the puff's own density towards it) and the sky, and an orange glow from below over a fire. Flames are
  quads stretched along their motion into teardrop tongues, eaten away by rising turbulence and coloured
  by temperature (white-yellow root, orange, red tips); they are blended as emitted light with partial
  occlusion so they build into a body of flame instead of a white blob. A surge throws a ball of flame out
  of the intake and the nozzle.
- **Streaks** are embers, glowing fragments that cool as they fly, and liquid spray. **Shards** are small
  metal fragments that tumble, bounce and lie on the floor for a while.

## Supplying your own model

## Steps

1. Export the model as binary glTF (`.glb`). Blender, 3ds Max, Maya and most converters can do this.
   Draco-compressed files are not supported; export uncompressed.
2. Put it in `app/assets/` together with a `model.json`:

```json
{
  "file": "v2500.glb",
  "scale": 1.0,
  "position": [0, 0, 0],
  "rotation": [0, 0, 0],
  "parts": {
    "inlet":   { "match": "inlet|intake" },
    "fan":     { "match": "fan_blade|fan_disk", "spool": 1 },
    "spinner": { "match": "spinner|nose", "spool": 1 },
    "hpc":     { "match": "hpc_rotor", "spool": 2 }
  }
}
```

- `match` is a case-insensitive regular expression tested against node names in the file.
- `spool`: 1 turns with N1, 2 with N2, omitted = static.
- `scale`, `position`, `rotation` (degrees) bring the model into the simulator's frame:
  metres, engine axis along +x with air flowing in the +x direction, fan face at x = 0,
  centreline at y = z = 0, up = +y.
- Components not listed keep their generated geometry, so an exterior-only model can be combined
  with the generated internals.

Component ids: `inlet lip fancase fancowl cna spinner fan lpc lpccase hpc hpccase hpt hptcase lpt lptcase
lpshaft hpshaft bearings combcase liner fuel ign corecowl tec agb starter sav idg hydpump fuelpump fmu oilpump
pma oiltank exciters vsvact fdv accvalves acac egtbox mounts eec ext pylon`.

The cutaway wedge applies only to generated geometry. An authored casing is shown whole; split it
in the model (or hide it with Remove part) to see inside.

## Keeping models local

Everything in `app/assets/` except `.gitkeep` is ignored by git, so a model you drop in stays on
your machine. Do not publish or release a build containing a model you do not have the right to
distribute, free or paid.

## Where to get a model

Checked by web search in November 2026; licences were not verified, read them before buying or shipping.

- **"IAE v2500 Engine - Airbus A320 family"** by gen_3d on Sketchfab: a game-ready V2500 with animated
  reverser. Almost certainly exterior only. Licence not shown in search results.
- **"Turbofan Engine Cutaway (Aerospace 3D Model)"** by bagsantanu1109 on Sketchfab: about 422k triangles,
  listed as CC Attribution. A generic high-bypass engine, not a V2500.
- **CGTrader** sells CFM56 and generic turbofan full-and-cutaway packs commercially.
- Flight-simulator add-on engines (MSFS, X-Plane, Fenix and others) are proprietary and cannot be reused.

An accurate V2500 with full internals does not appear to exist as a stock asset. The realistic
routes to flight-simulator quality are an exterior model from a marketplace combined with the
generated internals, or commissioning a 3D artist to model the engine from photographs and the
public cutaway drawings.
