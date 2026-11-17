// Procedural engine sound. Nothing is sampled: every voice is synthesised from the
// simulation state, using the mechanisms that make a turbofan sound the way it does.
//
//   fan blade-pass tone   22 blades x N1: the pure whistle, strongest at approach power
//   buzz-saw              every shaft harmonic at once, when the fan tips are supersonic
//   fan broadband         rushing air, rises steeply with fan speed
//   jet mixing noise      low roar; intensity follows jet velocity (Lighthill's V^8 law, compressed)
//   combustion rumble     low, only with flame, follows fuel flow
//   HP spool              gearbox drone at N2 and a faint compressor whine far above it
//   start howl            the V2500's rising moan as N2 passes roughly 25-45 % during a start
//   starter               air turbine whine and duct hiss while the start valve is open
//   one-shots             igniter ticks, light-off thump, surge bang, reverser clunk
//
// Fan sounds radiate forwards and jet noise rearwards, so the mix follows the camera.

import { SamplePlayer } from './samples.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const bell = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

export class EngineAudio {
  /** @param ctx optional AudioContext / OfflineAudioContext (tests pass an offline one) */
  constructor(ctx = null) { this.ctx = ctx; this.on = false; this.offline = !!ctx && typeof ctx.startRendering === 'function'; if (ctx) this._build(); }

  /** Create the audio graph now (suspended until the first click) so recordings download straight away. */
  prepare() { if (!this.ctx) { this.ctx = new AudioContext({ latencyHint: 'interactive' }); this._build(); } }
  start() {
    if (!this.ctx) { this.ctx = new AudioContext({ latencyHint: 'interactive' }); this._build(); }
    this.ctx.resume(); this.on = true;
    this.out.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.3);
  }
  stop() { if (!this.ctx) return; this.on = false; this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08); }
  /** Replace the recordings with ones picked from the player's disk (browser folder chooser). */
  async loadRecordings(files) {
    if (!this.ctx) this.start();
    const old = this.samples; old.dispose();
    const sp = new SamplePlayer(this.ctx, this.sbus); const ok = await sp.load('', files, (a, b) => this.onSampleProgress && this.onSampleProgress(a, b));
    if (!ok) { this.samples = sp; this.bus.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3); return null; }
    this.samples = sp; this.bus.gain.setTargetAtTime(sp.synth === 'mix' ? 0.5 : 0, this.ctx.currentTime, 0.3);
    return sp;
  }
  setVolume(v) { this.volume = v; if (this.on) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  _noiseBuffer(seconds, seed) {
    const ac = this.ctx, buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate), d = buf.getChannelData(0);
    let s = seed >>> 0; for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; }
    return buf;
  }
  _noise(buf) { const n = this.ctx.createBufferSource(); n.buffer = buf; n.loop = true; n.start(0, Math.random() * 2); return n; }
  _gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  _filter(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  _osc(type, f = 100) { const o = this.ctx.createOscillator(); if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type); o.frequency.value = f; o.start(); return o; }
  _chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }

  _build() {
    const ac = this.ctx;
    this.volume = 0.8;
    // output: voices -> bus -> (dry + test-cell reverb) -> compressor -> volume
    this.bus = this._gain(1);        // synthesised voices
    this.sbus = this._gain(1);       // recordings
    this.evbus = this._gain(1);      // one-shot events (always audible)
    this.out = this._gain(this.offline ? 1 : 0);
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    // reverb: decaying filtered noise, like a hard-walled cell
    const ir = ac.createBuffer(2, Math.floor(ac.sampleRate * 1.3), ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let s = 99991 + ch * 7919, lp = 0; for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; const t = i / d.length; lp += 0.35 * ((s / 2147483648 - 1) - lp); d[i] = lp * Math.pow(1 - t, 3.2) * (i < 400 ? i / 400 : 1); } }
    const conv = ac.createConvolver(); conv.buffer = ir; const wet = this._gain(0.22);
    for (const b of [this.bus, this.sbus, this.evbus]) b.connect(comp);
    this._chain(this.bus, conv, wet, comp); this.evbus.connect(conv); this._chain(comp, this.out, ac.destination);
    this.samples = new SamplePlayer(ac, this.sbus);
    if (!this.offline) this.samples.load('sounds/', null, (a, b) => this.onSampleProgress && this.onSampleProgress(a, b)).then((ok) => {
      if (ok) { this.bus.gain.setTargetAtTime(this.samples.synth === 'mix' ? 0.5 : 0, ac.currentTime, 0.3); this.onSamples && this.onSamples(this.samples); }
      else this.onSamples && this.onSamples(null);
    });

    const nA = this._noiseBuffer(4.1, 1234567), nB = this._noiseBuffer(3.7, 7654321), nC = this._noiseBuffer(4.7, 24680);
    const v = (this.v = {});
    // jet mixing noise
    v.jetLp = this._filter('lowpass', 200, 0.5); v.jetShelf = this._filter('lowshelf', 160); v.jetShelf.gain.value = 6; v.jet = this._gain();
    this._chain(this._noise(nA), v.jetLp, v.jetShelf, v.jet, this.bus);
    // combustion rumble, slowly wandering in level
    v.rumbleBp = this._filter('bandpass', 105, 0.8); v.rumble = this._gain(); v.rumbleAm = this._gain(1);
    this._chain(this._noise(nB), v.rumbleBp, v.rumbleAm, v.rumble, this.bus);
    const lfo = this._chain(this._noise(nC), this._filter('lowpass', 6, 0.7), this._gain(2.2)); lfo.connect(v.rumbleAm.gain);
    // fan broadband
    v.fanBp = this._filter('bandpass', 900, 0.55); v.fanN = this._gain();
    this._chain(this._noise(nC), v.fanBp, v.fanN, this.bus);
    // fan blade-pass tone and its second harmonic, with a slightly detuned twin so it beats like the real thing
    v.bpf1 = this._osc('sine'); v.bpf1b = this._osc('sine'); v.bpf2 = this._osc('sine'); v.bpf = this._gain(); v.bpf2g = this._gain(0.35);
    v.bpf1.connect(v.bpf); v.bpf1b.connect(v.bpf); this._chain(v.bpf2, v.bpf2g, v.bpf); v.bpf.connect(this.bus);
    // buzz-saw: one oscillator at shaft speed carrying 40 harmonics of uneven strength (blade-to-blade differences)
    const N = 44, re = new Float32Array(N), im = new Float32Array(N); let s = 4242;
    for (let k = 1; k < N; k++) { s = (s * 1664525 + 1013904223) >>> 0; const r = s / 4294967296; im[k] = (0.25 + r) * bell(k, 14, 12) * (k === 22 ? 0.3 : 1); }
    v.buzzO = this._osc(ac.createPeriodicWave(re, im)); v.buzzHp = this._filter('highpass', 180, 0.7); v.buzz = this._gain();
    this._chain(v.buzzO, v.buzzHp, v.buzz, this.bus);
    // HP spool: gearbox drone and compressor whine
    v.droneO = this._osc('sawtooth'); v.droneLp = this._filter('lowpass', 420, 1.2); v.drone = this._gain(); this._chain(v.droneO, v.droneLp, v.drone, this.bus);
    v.whineO = this._osc('sine'); v.whine = this._gain(); this._chain(v.whineO, v.whine, this.bus);
    // start howl: a narrow resonance swept upwards, tone plus breath
    v.howlBp = this._filter('bandpass', 200, 14); v.howlN = this._gain(); this._chain(this._noise(nA), v.howlBp, v.howlN, this.bus);
    v.howlO = this._osc('triangle'); v.howlO2 = this._osc('sine'); v.howl = this._gain(); v.howlO.connect(v.howl); this._chain(v.howlO2, this._gain(0.5), v.howl); v.howl.connect(this.bus);
    // starter
    v.stO = this._osc('sawtooth'); v.stLp = this._filter('bandpass', 2000, 3); v.st = this._gain(); this._chain(v.stO, v.stLp, v.st, this.bus);
    v.hissBp = this._filter('bandpass', 3200, 0.9); v.hiss = this._gain(); this._chain(this._noise(nB), v.hissBp, v.hiss, this.bus);
    // reverser efflux
    v.revBp = this._filter('bandpass', 520, 0.45); v.rev = this._gain(); this._chain(this._noise(nC), v.revBp, v.rev, this.bus);
    this.noiseA = nA; this.tick = 0; this._lit = false; this._rev = 0;
  }

  _set(param, value, tau = 0.06) {
    if (!Number.isFinite(value)) return;
    if (this.offline) param.setValueAtTime(value, 0); else param.setTargetAtTime(value, this.ctx.currentTime, tau);
  }

  /** One-shot: filtered noise burst with an optional pitched thump. */
  _burst({ gain = 1, dur = 0.4, lp = 200, hp = 20, thump = 0, thumpTo = 30, at = 0 }) {
    const ac = this.ctx, t = ac.currentTime + at, src = ac.createBufferSource(); src.buffer = this.noiseA;
    const g = this._gain(0); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    this._chain(src, this._filter('lowpass', lp, 0.6), this._filter('highpass', hp, 0.6), g, this.evbus); src.start(t, Math.random() * 3, dur + 0.05);
    if (thump) { const o = ac.createOscillator(), og = this._gain(0); o.frequency.setValueAtTime(thump, t); o.frequency.exponentialRampToValueAtTime(thumpTo, t + dur * 0.8); og.gain.setValueAtTime(gain * 0.9, t); og.gain.exponentialRampToValueAtTime(0.0008, t + dur); this._chain(o, og, this.evbus); o.start(t); o.stop(t + dur + 0.05); }
  }
  /** Compressor surge: a sharp crack over a deep thud. */
  bang(strength = 1) { if (!this.on) return; if (this.samples.play('surge', strength)) return; this._burst({ gain: 1.6 * strength, dur: 0.5, lp: 260, thump: 95, thumpTo: 28 }); this._burst({ gain: 0.7 * strength, dur: 0.09, lp: 5200, hp: 900 }); }
  lightoff() { if (!this.on || this.samples.has('lightoff')) return; this._burst({ gain: 0.5, dur: 0.7, lp: 150, thump: 60, thumpTo: 35 }); }
  clunk() { if (!this.on) return; if (this.samples.play('reverser')) return; this._burst({ gain: 0.45, dur: 0.12, lp: 900, hp: 80, thump: 140, thumpTo: 70 }); this._burst({ gain: 0.3, dur: 0.1, lp: 1200, hp: 100, at: 0.16 }); }
  _tick() { if (this.samples.play('igniter')) return; this._burst({ gain: 0.16, dur: 0.018, lp: 7000, hp: 1800 }); }

  /**
   * @param o        simulation outputs
   * @param dt       real seconds since the last call
   * @param listener {front: 0..1 (1 = in front of the intake), near: ~0.6..1.4 loudness from distance}
   */
  update(o, dt, listener = { front: 0.5, near: 1 }) {
    if (!this.ctx || (!this.on && !this.offline)) return;
    const v = this.v, S = (p, x, tau) => this._set(p, x, tau);
    const n1 = clamp(Math.abs(o.N1pct) / 100, 0, 1.15), n2 = clamp(o.N2pct / 100, 0, 1.15);
    const f1 = Math.abs(o.N1) / 60, f2 = o.N2 / 60; // shaft frequencies, Hz
    const front = 0.35 + 0.95 * listener.front, rear = 0.4 + 0.9 * (1 - listener.front), near = listener.near;
    const vj = clamp((o.V9 || 0) / 330, 0, 1.3), flow = clamp((o.W9 || 0) / 390, 0, 1.2);

    // jet: quiet until the jet is fast, then dominant
    S(v.jetLp.frequency, 70 + 950 * vj * vj + 140 * flow);
    S(v.jet.gain, (0.035 * flow + 0.95 * Math.pow(vj, 3.4) * Math.sqrt(flow)) * rear * near);
    // combustion
    const burn = o.lit ? Math.sqrt(clamp(o.wf / 1.1, 0, 1.3)) : 0;
    S(v.rumbleBp.frequency, 85 + 70 * n2); S(v.rumble.gain, (0.05 + 0.24 * burn) * (o.lit ? 1 : 0) * near, 0.15);
    // fan broadband
    S(v.fanBp.frequency, 500 + 2300 * n1); S(v.fanN.gain, 0.5 * Math.pow(n1, 2.6) * front * near);
    // blade-pass tone: clear whistle at low and middle fan speeds, masked by buzz-saw and roar at the top
    const bpf = 22 * f1;
    S(v.bpf1.frequency, bpf, 0.03); S(v.bpf1b.frequency, bpf * 1.0035 + 0.7, 0.03); S(v.bpf2.frequency, 2 * bpf, 0.03);
    S(v.bpf.gain, (0.012 + 0.11 * bell(n1, 0.55, 0.3) + 0.04 * n1) * (n1 > 0.03 ? 1 : 0) * Math.min(1, n1 * 6) * front * near);
    // buzz-saw: fan tip speed is 477 m/s at 100 % N1, so tips pass Mach 1 relative near 70 %
    S(v.buzzO.frequency, Math.max(f1, 1), 0.03); S(v.buzz.gain, 0.42 * Math.pow(clamp((n1 - 0.7) / 0.25, 0, 1.2), 1.6) * front * near);
    // HP spool
    S(v.droneO.frequency, Math.max(f2, 1), 0.03); S(v.droneLp.frequency, 260 + 500 * n2); S(v.drone.gain, 0.05 * Math.min(1, n2 * 3) * (0.5 + 0.5 * n2) * near);
    S(v.whineO.frequency, Math.min(28 * f2, 9000), 0.03); S(v.whine.gain, 0.016 * n2 * n2 * (0.6 + 0.4 * front) * near);
    // start howl: only while the core is accelerating through the band, with the starter on or just after light-off
    const starting = o.tStart > 0 || (o.lit && n2 < 0.57);
    const hf = 150 + 620 * clamp((n2 - 0.1) / 0.45, 0, 1);
    const hk = starting ? bell(n2, 0.34, 0.13) * (o.lit ? 1 : 0.55) : 0;
    S(v.howlBp.frequency, hf, 0.04); S(v.howlO.frequency, hf, 0.04); S(v.howlO2.frequency, hf * 2.01, 0.04);
    S(v.howl.gain, 0.2 * hk * near, 0.12); S(v.howlN.gain, 2.2 * hk * near, 0.12);
    // starter: air turbine spins far faster than the core
    const stOn = o.tStart > 0 ? 1 : 0;
    S(v.stO.frequency, 320 + 5200 * n2, 0.04); S(v.stLp.frequency, 700 + 5200 * n2, 0.04); S(v.st.gain, 0.05 * stOn * near, 0.1); S(v.hiss.gain, 0.07 * stOn * near, 0.15);
    // reverser efflux blows forwards
    S(v.rev.gain, 0.5 * (o.rev || 0) * Math.pow(clamp((o.Wcas || 0) / 250, 0, 1.2), 1.5) * (0.6 + 0.6 * listener.front) * near);

    if (this.offline) return;
    this.samples.update(o, listener);
    // events derived from state
    if (o.ignOn) { this.tick += dt; if (this.tick > 0.62) { this.tick = 0; this._tick(); if (this.on) setTimeout(() => this.on && this._tick(), 210); } }
    if (o.lit && !this._lit && n2 < 0.5) this.lightoff();
    this._lit = o.lit;
    const moving = (o.rev > 0.02 && this._rev <= 0.02) || (o.rev < 0.98 && this._rev >= 0.98) || (o.rev >= 0.98 && this._rev < 0.98) || (o.rev <= 0.02 && this._rev > 0.02);
    if (moving) this.clunk();
    this._rev = o.rev || 0;
  }
}
