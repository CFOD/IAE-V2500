# V2500 reference notes

Observations from reference images supplied by the project owner (museum cutaway model, MTU and
manufacturer photos of bare engines, the IAE cutaway drawing, a stage diagram, on-wing nacelle
photos, a fan close-up). The images are third-party copyright and are not stored in this repository;
these notes record what they show so modelling can continue from them.

Status: [x] reflected in the model, [ ] still to do.

## Fan and spinner
- [x] Spinner is a long, straight-sided cone in two pieces: dark charcoal nose cone with a small white
      tip and a white crescent; light grey rear fairing with recessed bolt pockets around it.
- [x] 22 wide-chord blades, strongly twisted, chord growing toward the tip, no part-span shrouds.
- [x] Light grey annulus fillers form the hub surface between blades.
- [x] Light blue abradable fan-track liner around the blade tips; grey perforated acoustic panels
      ahead of and behind it.
- [x] Blade leading edge has a slight S-shaped sweep; tips are squared with a thin bright edge.
- [x] Fan outlet guide vanes sit well aft of the fan, at the fan frame. (Not yet leaned.)

## Core (from the cutaway drawing, museum model and stage diagram)
- [x] Fan + 4 booster stages (A5), 10 HPC stages, annular combustor, 2 HPT stages, 5 LPT stages.
- [x] Booster sits on a drum directly behind the fan disc, casing nearly cylindrical, then a long
      swan-neck duct down to the HPC inlet, crossed by structural struts (intermediate case).
- [x] HPC casing tapers steadily; rotor is a stacked drum with visible disc webs in section.
- [x] Combustor is short; diffuser case bulges outward; fuel nozzles enter at a steep angle.
- [ ] LPT flares strongly; exit diameter is roughly 60 % of the fan diameter.
- [x] Turbine exhaust case has a wide outer ring and a short blunt centre-body, not a long plug.
- [x] LPT case is wrapped in a cage of cooling manifold rings (active clearance control).
- [x] Orange-red blanked ports are visible on the museum model (bleed duct flanges) at the HPC rear
      and under the combustor.

## Bare-engine dress (visible with cowls open)
- [x] Fan case is bare silver metal with several stiffening ribs, not painted (under the fan cowl doors).
- [x] A large silver duct runs round the fan case circumference from the top to the bottom.
- [x] Oil tank: a tall domed cylinder on the side of the fan case.
- [x] Accessory gearbox hangs under the fan case (not under the core), wide and flat, with the
      starter, generator, hydraulic pump and fuel pump on it, and harness bundles. Accessories are flanged,
      finned and bolted bodies with their pipes; still simplified against the photos.
- [x] Core is densely dressed with pipes on brackets, fuel pigtails to each nozzle, exciter and valve boxes.
- [x] EEC box is on the upper side of the fan case.

## Nacelle (on-wing photos)
- [x] Inlet lip is matte bare metal with a visible seam where it meets the painted cowl.
- [x] Common nozzle at the rear is unpainted metal, with a visible step from the painted cowl.
- [x] A strake sits high on the cowl side.
- [x] Panel lines: inlet cowl / fan cowl / reverser / nozzle gaps and the bottom latch line (Blender build).
- [x] Latches along the bottom line.
- [ ] Hinge line at the top.
- [x] Pressure-relief door and oil-service door outlines on the fan cowl; red hazard stripe and lettered placards.
- [x] Drain mast underneath; pylon fairing. (No wing to blend into.)
- [ ] Overall nacelle is long and nearly cylindrical, slightly drooped at the inlet.

## Thrust reverser (no reference image yet: built from general knowledge of the type)
- [x] Fixed torque box, translating sleeve, cascade ring, ten blocker doors hinged in the sleeve's inner wall.
- [x] Sleeve travel and door swing are driven by the simulation's reverser state.
- [ ] Check proportions, cascade count and door linkage against a reverser-deployed photo.
- [ ] Drag links from the doors to the core cowl; actuators.

## Still generated, not yet rebuilt
- [x] Rotors are stacked discs (rim, web, bore) and are sectioned in the lower part of the cutaway.
- [x] Five main bearings with support cones, LP and HP shafts in section. [ ] Oil pipes inside the core.
- [x] Textures: riveted and weathered paint, heat discolouration on the hot section and nozzle, lettering.
- [x] Fan and compressor blades carry a surface texture (polishing marks, worn leading edge and tip, root dirt); casings have a cast finish.

## Section-view convention
The museum model leaves cut faces bare grey and uses colour for liners. The simulator currently
paints cut faces red-orange (another common museum convention). Either is defensible.

## More references
Wikimedia Commons has about 70 V2500 photos (Category:IAE V2500), including a thrust-reverser-deployed
shot, on-wing close-ups and the museum cutaway. Its image server rate-limited the build environment,
so they have not been used yet.
