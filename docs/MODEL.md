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
