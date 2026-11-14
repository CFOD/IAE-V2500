# Using an authored 3D model

The engine you see is generated in code (`app/scene3d.js`). Any component can be replaced by
meshes from a glTF model, and it keeps working as that component: it is clickable, removable,
glows with temperature, moves in the exploded view and turns with its spool.

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
