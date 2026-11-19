# Damage you can see, and the borescope

What the simulation does to the blades and vanes now shows on the model. A bird bends fan blade tips, a stone
nicks a leading edge, a streaking fuel nozzle burns the HP turbine guide vanes behind it, and an overheat
tints the turbine blades. The **Inspect** tab puts a borescope into the engine through the real inspection
ports, with a light at its tip and a fisheye lens, so you can turn the spool a blade at a time and find the
damage the way an engineer does after a bird strike or an over-temperature.

- **Damage records:** `src/sim/failures.js` (`Failures.dmg`, written by `ingest`) and `src/sim/damage.js`
  (`ngvBurn`, `TbHmax`, `TbLmax`).
- **Deformed blades and heat colours:** `app/damage3d.js`.
- **The probe:** `app/borescope.js`. The ports come from the model (`model.json` `ports`, written by
  `tools/blender/details.py`).

## What gets damaged

### Things that go through the intake

Every object the engine swallows (docs/APRON.md) leaves records of which blades it hit, where along the span,
how, and how badly. Each record is a position round the row (so a blade number), a span from 0 at the hub to
1 at the tip, a kind and a severity from 0 to 1. A row keeps at most 60.

| Kind | Cause | What the blade looks like |
|---|---|---|
| Dent | soft or semi-rigid object, light blow | the leading edge pushed back against the rotation over a short length |
| Bend | soft or semi-rigid object, severity over 0.4 | the tip curled back against the rotation, from part-way up the span |
| Tear | semi-rigid object (cone, suitcase), severity over 0.7 | the leading-edge corner of the tip torn away |
| Nick | hard object (bolt, stone) | a small notch in the leading edge |

How many blades:

- **Soft and semi-rigid objects in the bypass:** 1 to 6 fan blades, more with the energy of the blow. The
  first takes the full severity and each one after it 20 % less.
- **In the core:** the fan root takes a light dent, and the booster's first stage is dented if the booster
  was damaged.
- **Hard objects:** a nick in one fan blade, or in two booster blades if it went into the core, plus three
  HP compressor stage 3 blades if it broke a compressor blade.

The span comes from the radius where the object went in. A goose at take-off typically bends three fan
blades and curls one tip right back; a bolt leaves one nick.

### A streaking fuel nozzle

The **Streaking fuel nozzle** fault (nozzle No. 13, at 225 degrees) burns the HP turbine stage 1 guide vanes
in its path, 15 degrees round from the stage 1 borescope port at 210 degrees. To see them, turn the probe
tip to look along the row of vanes.

- The burn grows while the engine runs lit with the fault on, with the fuel flow and N2. At take-off power
  it reaches full in about two and a half minutes, at climb power in about six; at idle it takes over an
  hour.
- The vanes in the middle of the streak go first; it spreads about 11 degrees each side.
- **Discoloured coating:** the vanes darken towards brown as the thermal barrier coating burns.
- **Burnt trailing edges:** past about a third, the trailing edges burn back raggedly over the middle of the
  span, up to about half the chord.

The fault also takes HP turbine creep life (docs/FAILURES.md).

### Overheating

The highest turbine blade metal temperatures the engine has reached are kept. HP turbine stage 1 blades
colour from 1,250 K (about 980 °C): straw, then bronze, then blue at about 1,500 K. Stage 2 colours a
little less. The streak tints every HP blade a little, because each passes through it once a turn. The first
LP turbine stage colours the same way from 1,180 K.

### Clearing it

- **Repair all** (Faults tab) replaces the blades hit by ingested objects.
- **Restore new-engine condition** (Hardware tab) also replaces the burnt vanes and overheated blades, which
  count as engine damage, like used creep life.

## How it is drawn

Each damaged blade or vane is a copy of its row's template, deformed by the records and put in the place of
the instance it stands in for, which is hidden. The copy turns with its spool and is cut away with its row.

To deform a blade, its vertices are sorted into 40 slices along the span. In each slice the foremost vertex
is the leading edge and the rearmost the trailing edge, which gives every vertex a position along the chord.
The displacements are smooth functions of span and chord:

- **Dent:** a Gaussian 8 % of the span wide, fading over the front fifth of the chord.
- **Bend:** grows smoothly from part-way up the span to the tip, a little less at the trailing edge.
- **Tear:** pulls the vertices beyond a slanted cut line in to it.
- **Burn:** moves the trailing edge forward by a ragged amount.

Heat colours are per-instance colours on the rows, so they cost nothing.

## The borescope

Open the **Inspect** tab and pick a port.

| Port | Where | What it sees |
|---|---|---|
| Fan | from the intake, 24 degrees from the top | fan blades and annulus fillers |
| Booster stage 1 | past the fan, through the core inlet guide vanes | booster stage 1 blades |
| HP compressor stages 3, 5, 7, 9 and 11 | on the HP compressor case, 300 degrees | that stage's blades, from the gap behind them |
| HP turbine stage 1 | 210 degrees (and a second port at 300) | stage 1 guide vane trailing edges and blade leading edges |
| HP turbine stage 2 | 255 degrees | stage 1 blade trailing edges and stage 2 vanes |
| LP turbine stages 3, 5 and 7 | 240 degrees | that stage's blades |
| Combustor 1 to 6 | round the diffuser case, every 60 degrees | liner, dome and fuel nozzles |

The probe tip sits in the axial gap between the rotor row the port serves and the vane row next to it.

**Controls:**

- **Steer:** drag. The tip can turn right round, to look at the vanes behind it.
- **Push in or pull out:** scroll or pinch. This changes the radius, from near the tips towards the hub.
- **Turn the spool:** the buttons at the bottom turn it 1 or 5 blades either way. It eases round, as when a
  mechanic turns the core by hand at the gearbox cranking pad.
- **Leave:** the Leave button or Escape.

**Readout:** the top-left shows what the middle of the picture is (for example *Fan blade 7 of 22*), what is
wrong with it (*tip curled back (severe)*, *coating discoloured by a hot streak*, *bronze heat tint:
overheated*), and how many blades you have turned.

**Damage recorded:** the tab lists every record. **Look** puts the probe in the right port and turns the
spool until that blade is in front of it. For the guide vanes, which cannot turn, it steers the tip round to
the worst one. The aim uses the blade's own surface at the damaged span. A staggered fan blade's leading edge
is well round from its root, so the probe aims a quarter of the chord back from the leading edge, or from
the trailing edge when it sits behind the row.

**The image:**

- **Light:** the only light is the probe's. Scene lights are dimmed to 2 % and the environment to 4 %.
- **Exposure:** like the camera in a real probe, the gain follows how far away the scene is. Five rays
  measure the distance, and the centre one and the median set the LED brightness (centre-weighted), so a
  blade 1 cm away is not burnt out and the far side of the fan is not lost.
- **Lens:** a fisheye with a round, vignetted image, a warm LED tint and a little sensor noise. It runs on
  every quality setting, Low included, while you inspect.

Inspect with the engine shut down: a turning spool just blurs past.
