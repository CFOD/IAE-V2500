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
- [x] Hinge fairings along the top, each side of the pylon.
- [x] Pressure-relief door and oil-service door outlines on the fan cowl; red hazard stripe and lettered placards.
- [x] Drain mast underneath; pylon fairing. (No wing to blend into.)
- [ ] Overall nacelle is long and nearly cylindrical, slightly drooped at the inlet.

## Thrust reverser (no reference image yet: built from general knowledge of the type)
- [x] Fixed torque box, translating sleeve, cascade ring, ten blocker doors hinged in the sleeve's inner wall.
- [x] Sleeve travel and door swing are driven by the simulation's reverser state.
- [ ] Check proportions, cascade count and door linkage against a reverser-deployed photo.
- [x] Four hydraulic actuators in the cascade bay; a drag link from the core cowl to each blocker door, moving with the reverser.

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

## Added without a specific photo reference (typical arrangement)
- Fan case dressed all round: flange bolts, looms and clips, anti-ice duct and valve, ignition exciters, air-cooled oil cooler, relay boxes, forward mount yoke and links.
- EEC with cooling fins, feet, connectors and looms; gearbox mount links, oil lines, alternator, de-oiler.
- Pylon: leading-edge fairing, box, aft fairing, panel lines and access panels. Sectioned with the cutaway.
- Upper core: stage 7 and stage 10 bleed ducts and valves, fuel feed, harness trunk.

## From IAE / operator training notes (search-result excerpts, November 2026; the documents themselves could not be opened)
- [x] Bearings 1, 2 and 3 share the front compartment at the centre of the intermediate case; No. 4 is in the diffuser / combustor case; No. 5 in the turbine exhaust case.
- [x] Oil tank on the left of the external gearbox, about 7 o'clock on the fan case. EEC on the right side of the fan case.
- [x] Gearbox front face: starter, hydraulic pump, oil pressure pump, de-oiler, dedicated alternator.
- [x] Front mount at the rear of the intermediate case; rear mount on the LPT case at top dead centre.
- [x] EGT probes in the exhaust case struts at about 2, 4.30, 7.30 and 9.30 o'clock. P2/T2 sensor near 12 o'clock in the inlet.
- [x] 20 fuel nozzles fed in pairs from ten manifolds; two igniters on the diffuser case; three stage-7 and one stage-10 handling bleed valves.
- [x] Reverser: four hydraulic actuators (upper pair non-locking, lower pair locking).
- [ ] Not found: number of blocker doors and cascade segments, fan outlet guide vane count, clock positions of the bleed and ACC valves. The model's values for these are assumptions.

## From the SR Technics "V2500 Component Location" training booklet (issue 2.04, 2010), supplied by the project owner
The booklet itself is not in the repository (training material, not ours to publish). What was taken from it:
- [x] Colours: fan case and compressor cases painted light blue-grey; looms in white braid; accessory units chromate gold; graphite-composite cascades; EEC with a gold chassis and dark cover.
- [x] Right side of the fan case, top to bottom: EEC, ignition / P2T2 relay box, bank of bleed-valve solenoids (four and two), air-cooled oil cooler; anti-ice valve and duct forward; starter valve low, starter duct up the right side.
- [x] Left side: fuel-cooled oil cooler (tall cylinder) with LP fuel filter and diverter valve, IDG oil cooler, oil pressure transmitter and switch near the top, vibration pick-up at the top, oil tank low beside the gearbox.
- [x] Gearbox, left to right: front face oil pump and filter, hydraulic pump, alternator, starter; rear face fuel pump and FMU, scavenge pumps, IDG; de-oiler at the right-hand end; scavenge filter with master chip detector at the left rear.
- [x] Core: handling bleed valves 7A, 7B and 10 on the right and 7C on the left, each a perforated dome with an orange silicone seal; VSV actuator and HP valve on the left; fuel distribution valve with ten outlets; ignition boxes on the right behind the fan frame; ACC actuator with separate LPT and HPT valves; buffer air cooler low on the left; EGT junction box underneath.
- [x] Exhaust: EGT probes at 2, 4.30, 7.30 and 9.30; P4.9 rakes in three struts. Reverser: upper non-locking and lower locking actuators joined by flexible shafts; six latches along the bottom.
- [ ] Still to do from it: HCU and pylon disconnect panels, fire detection loops, P4.9 rakes as separate parts, fan-blade annulus fillers and dovetail slots, the bifurcation and its latches.
