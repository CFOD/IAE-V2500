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
green primer inside the cowls, straw-bronze-purple heat tint on the turbine cases and a bronze
exhaust cone.

The detail follows the Quality button: Low draws plain materials (heat tint and soot stay, since they
show temperature), Medium adds grain, mottling, scratches and grime, High adds the micro-bump, and
Ultra switches to a 1024-pixel detail texture with 16x anisotropic filtering for close-ups. The
texture and level are shared uniforms, so switching never recompiles a shader.

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

### The aircraft (apron scene)

`tools/blender/apron.py` builds the A320 the engine hangs on, for the Apron tab, as `app/models/apron.glb`
(see docs/APRON.md). It has the fuselage with windows, door outlines and belly fairing, the wings with panel
lines, flap-track fairings and wingtip fences, the tail, both gears with twin wheels and chocks, and engine 2.
It is loaded only when the apron is first shown.

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
