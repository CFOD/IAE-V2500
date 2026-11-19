# The engine on the apron

The **Apron** tab puts the engine on its aircraft: an A320, nose-in on a painted stand, with the engine as
No. 1 on the left wing. You can drop things near it — birds, a traffic cone, a rag, a plastic bag, a bolt, a
stone, a suitcase — and watch the intake draw them in or the jet blow them away. What goes in damages the
engine, through the same failure model as everything else (docs/FAILURES.md).

- **Physics:** `src/sim/ground.js`, tested in `tests/ground.test.js`.
- **3D view:** `app/apron3d.js`.
- **Aircraft model:** `tools/blender/apron.py`, which writes `app/models/apron.glb` and `apron.json`. It is
  loaded the first time the apron is shown, and the web build gzips it like the engine.

## Where things are

The 3D view and the physics share one frame: the engine's own, in metres. x runs aft along the engine axis,
y is up, and z points to the aircraft's left (outboard of engine 1).

| Item | Position | Source |
|---|---|---|
| Ground | 1.87 m below the engine axis (nacelle low point 0.76 m above it at normal weights) | Airbus AC 2-3-0, ground clearances |
| Fuselage centreline | 5.75 m inboard of the engine | |
| Nose | about 11 m ahead of the inlet lip | |
| Main gear | 17.71 m behind the nose, 7.59 m track | |
| Nose gear | 5.07 m behind the nose | |

Other aircraft dimensions:

- Length 37.57 m.
- Fuselage 3.95 m wide and 4.14 m high.
- Wing span 34.10 m with wingtip fences, 25 degrees of sweep at quarter chord, 5.1 degrees of dihedral.
- Main tyres 46 x 17 R20; nose tyres 30 x 8.8 R15.

Where the drawings give no figure (exact window, door and flap-track stations), values are read off the
three-view and are approximate.

The model has:

- A fuselage with a row of windows each side, cockpit windows, door and cargo-door outlines, and a grey belly
  fairing.
- Wings with panel lines, flap-track fairings, wingtip fences and navigation lights.
- The fin and tailplanes.
- Both main gears (oleo, torque links, drag strut, side stay, leg door, twin wheels with hubs and bolts,
  chocks) and the nose gear.
- Engine No. 2 (outside only).

The stand is concrete in 5 m slabs, with oil and rubber stains, a yellow lead-in line with an A320 stop bar,
and the red equipment restraint line. The light is daylight, with sky and haze.

## The air near the ground

### Intake

The intake is a sink that swallows the engine's volume flow (W2 / density). Its centre sits 0.35 m inside
the inlet, so the lip plane sees the full inflow. It draws mostly from ahead; about a third of the flow comes
from behind the lip, shaded by the nacelle. Air from behind the lip is drawn towards a point just ahead of
it, so it runs forward along the cowl and round the lip.

An image sink below the ground keeps air from passing through it. At the ground plane the vertical flow is
zero; a test checks this.

### Ground vortex

An engine standing still with its inlet 1.25 diameters above the ground forms a vortex between the two. In
the model:

- **Strength.** Its circulation is 0.4 x inlet speed x diameter.
- **Position.** It wanders round the ground stagnation point under the lip and pulses in strength. Both are
  random processes that revert to a mean.
- **Near the ground.** Friction slows the swirl and the inflow takes over, sweeping debris into the core
  (the tea-leaf effect). A narrow updraft in the core and a broader, gentler one round it lift what arrives.
- **Strength by power.** At take-off the core updraft exceeds 50 m/s, enough to lift a bolt or a stone once
  the core passes over it. At idle the vortex is weak and only lifts a plastic bag.
- **What you see.** The vortex rope and dust in the 3D view follow its foot.

### Calibration against the Airbus danger areas (AC 6-3)

Take the intake danger boundary as a contour of induced air speed, 1.0 m/s:

| Power | Model | Airbus |
|---|---|---|
| Idle | 2.8 m | 2.74 m |
| Breakaway | about 4.9 m | 5.0 m |
| Take-off | about 7.4 m | 5.18 m |

At take-off the model is more cautious than the published area. The view draws both: the modelled area as
a red fill, and the Airbus area as a dashed white line, interpolated by thrust.

### Exhaust

The exhaust is a round turbulent jet from the common nozzle (1.19 m across). It has a potential core of
seven diameters, then the centreline speed falls as 1/distance. The profile is Gaussian, with a half-speed
radius growing 0.11 m per metre. Beyond about 17 m the jet sinks towards the ground as it spreads.

Against the Airbus exhaust velocity contours (AC 6-1):

| Power | Speed at the ground | Model | Airbus |
|---|---|---|---|
| Take-off | 60 m/s | about 39 m behind the nozzle | about 40 m |
| Take-off | 30 m/s | about 80 m | about 78 m |
| Idle | 15 m/s | about 36 m | about 36 m |

The view's exhaust danger area is where the ground jet is still above 10 m/s. At idle that is about 50 m,
against Airbus's 55 m.

### Reverse thrust

With the reverser deployed, only the core stream goes aft. The bypass air leaves forwards and outwards
from the cascades at 45 degrees.

### Turbulence

Turbulence is a random gust of about 14 % of the local speed.

## Loose objects

Each object is a point mass. The forces on it:

- **Drag.** The drag area is a tumbling average. Drag is integrated implicitly, so even a 12 g bag in a
  100 m/s jet stays stable.
- **Weight.**
- **Ground friction,** static and sliding; rolling for a cone or suitcase on its side.
- **Tumbling lift.** A fluctuating lift from the wind across it makes things hop and fly in strong air.
- **Toppling.** Tall objects (cone, suitcase) topple when the wind's moment about the leeward edge beats
  their weight's. A 0.75 m cone goes over at about 17 m/s.
- **Size.** Big objects feel the air averaged over their size, so a suitcase is not lifted by a vortex core
  narrower than itself.
- **Bounces** off the ground and slides along the nacelle.

| Object | Mass | Drag area | Hit | Notes |
|---|---|---|---|---|
| Pigeon | 0.35 kg | 0.012 m² | soft | flies at 12 m/s |
| Gull | 0.9 kg | 0.025 m² | soft | flies at 11 m/s |
| Canada goose | 3.6 kg | 0.06 m² | soft | flies at 15 m/s |
| Traffic cone | 3.0 kg | 0.11 m² (0.16 lying) | semi | 0.75 m tall, topples |
| Shop rag | 0.06 kg | 0.08 m² | soft | |
| Plastic bag | 0.012 kg | 0.1 m² | soft | |
| Bolt | 0.035 kg | 0.00045 m² | hard | terminal speed about 35 m/s |
| Stone | 0.05 kg | 0.0008 m² | hard | |
| Suitcase | 18 kg | 0.35 m² | semi | topples |

### Birds

A bird flies at its own speed through the moving air. Once the air reaches about a third of its flying
speed it turns away and flies against it. If the air is faster than the bird can fly, it goes in. At idle
birds escape even close to the lip; at take-off one within about a metre of the intake is caught.

## Ingestion and damage

Anything that crosses the inlet inside the lip is ingested. `Failures.ingest` grades the damage by the energy
of the fan's blow: half the mass times the square of the blade's speed relative to the object (blade speed
at the radius where it went in, combined with the axial air speed).

### Core or bypass

Small objects entering near the hub can follow the core flow. The fan flings heavy ones outwards into the
bypass duct.

### Damage by kind of object

- **Soft (birds, cloth, plastic).**
  - Fan damage is the energy over 400 kJ.
  - In the core, the booster is damaged too.
  - Above 150 kJ a fan blade can break off. That is a big bird at take-off, and the certification tests
    allow it.
- **Semi-rigid (cone, suitcase).**
  - Fan damage is the energy over 250 kJ.
  - Above 100 kJ blades can break off (two above 600 kJ).
  - Above 400 kJ the debris also damages the core.
- **Hard (bolt, stone).**
  - A nick in a fan blade.
  - In the core, the blow at HP compressor blade speed can break a compressor blade (the existing
    `hpcBlade` failure).

### How the damage acts on the engine

| Damage | Effect |
|---|---|
| Fan | fan efficiency down 8 points per unit of damage, flow down 4 %, N1 vibration up |
| Booster | booster efficiency down 6 points, flow down 3 % |
| Large fan damage, or booster damage at power | fan or booster surge |
| Broken blades and compressor blades | the same failures as the Faults tab (missing blades in the 3D view, burst debris) |

The log names what went in, where, at what N1, with what energy, and what it did. For example: *"BIRD STRIKE:
canada goose into the fan at 84 % N1 (227 kJ) - fan blades bent"*. **Repair all** on the Faults tab clears
the damage.

| Object | At idle | At take-off |
|---|---|---|
| Pigeon | about 1 kJ: nothing | about 25 kJ: dents |
| Goose | about 11 kJ: minor | over 200 kJ: bent blades, possibly a broken one |
| Traffic cone | | about 190 kJ: bent blades and often a broken one |

## Using it

1. Open the **Apron** tab and press **Show the aircraft on the apron**. The cutaway closes while you are
   there; going back to the test cell restores it.
2. Choose where to put things: click on the ground, in front of or under the intake, beside it, or behind
   the nozzle.
3. Press an object's button. With *Click on the ground*, the button stays lit and every click on the apron
   puts one down; press the button again when done.
4. Run the engine up and watch. The tab lists each object and what it is doing.
5. Use the **Danger areas** and **Air moving over the ground** boxes to show the modelled areas and the dust
   streaks traced through the same flow field the objects feel.
