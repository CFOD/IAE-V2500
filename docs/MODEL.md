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
packed into the bays between ribs by a small occupancy map so they do not overlap. Everything that
reaches the core crosses the bypass duct inside the lower bifurcation.

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

Component ids: `inlet lip fancase cna spinner fan lpc lpccase hpc hpccase hpt hptcase lpt lptcase
lpshaft hpshaft combcase liner fuel ign corecowl tec agb eec ext`.

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
