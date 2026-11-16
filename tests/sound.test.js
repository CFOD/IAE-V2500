import test from 'node:test';
import assert from 'node:assert/strict';
import { curve, parseIni, manifestFromFsx } from '../app/samples.js';

const CFG = `
// typical jet sound.cfg layout
[SOUND_ENGINE]
number_of_engines=2
eng1_combustion=COMBUSTION.1.00
eng1_starter=starter
eng1_combustion_start=combstart
eng1_shutdown=shut
eng1_jet_whine=jet_whine
eng1_non_combustion=NON_COMBUSTION.1.00

[COMBUSTION.1.00]
filename=xv25_1
flags=0
viewpoint=2
rparams=0.000,0.50,60.0,1.00,100.0,1.35
vparams=0.000,0.0,20.0,60.0,100.0,90.0
link=COMBUSTION.1.01

[COMBUSTION.1.01]
filename=v25_1
viewpoint=1
rparams=0,1,100,1.2
vparams=0,50,100,80

[jet_whine]
filename=xv25_w1.wav
viewpoint=2
rparams=0.0,0.4,100.0,1.6   ; pitch
vparams=0.0,0.0,30.0,70.0,100.0,100.0
link=jet_whine2

[jet_whine2]
filename=xv25_buzz
viewpoint=2
rparams=70,0.9,100,1.1
vparams=0,0,75,0,95,100

[NON_COMBUSTION.1.00]
filename=xv25_wind
viewpoint=2
rparams=0,0.6,60,1.1
vparams=0,0,10,40,60,60

[starter]
filename=xv25_start
viewpoint=2
[combstart]
filename=xv25_light
[shut]
filename=xv25_shut
viewpoint=2
`;

test('curve interpolates and clamps', () => {
  const c = [[0, 0], [50, 1], [100, 3]];
  assert.equal(curve(c, -5), 0); assert.equal(curve(c, 25), 0.5); assert.equal(curve(c, 75), 2); assert.equal(curve(c, 200), 3);
  assert.equal(curve([], 10), 1);
});

test('sound.cfg: sections and comments parse', () => {
  const ini = parseIni(CFG);
  assert.equal(ini.sound_engine.eng1_starter, 'starter');
  assert.equal(ini.jet_whine.rparams, '0.0,0.4,100.0,1.6');
});

test('sound.cfg converts to layers driven by the right spool, external view only', () => {
  const m = manifestFromFsx(CFG);
  const by = Object.fromEntries(m.layers.map((l) => [l.file, l]));
  assert.deepEqual(Object.keys(by).sort(), ['xv25_1.wav', 'xv25_buzz.wav', 'xv25_w1.wav', 'xv25_wind.wav']); // cockpit layer skipped
  assert.equal(by['xv25_1.wav'].driver, 'n2'); assert.equal(by['xv25_1.wav'].when, 'lit');
  assert.equal(by['xv25_w1.wav'].driver, 'n1');
  assert.equal(by['xv25_wind.wav'].when, 'unlit');
  assert.deepEqual(by['xv25_1.wav'].volume, [[0, 0], [20, 0.6], [100, 0.9]]);
  assert.equal(curve(by['xv25_1.wav'].pitch, 60), 1);
  assert.equal(curve(by['xv25_buzz.wav'].volume, 85), 0.5);
  assert.deepEqual(Object.keys(m.shots).sort(), ['lightoff', 'shutdown', 'starter']);
  assert.equal(m.shots.starter.file, 'xv25_start.wav');
});
