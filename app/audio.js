// Procedural engine sound (WebAudio): fan blade-pass buzz, HP spool whine,
// broadband jet roar, starter whine, igniter ticks and surge bangs.
export class EngineAudio {
  constructor() { this.on = false; }
  start() {
    if (this.ctx) { this.ctx.resume(); this.on = true; return; }
    const ac = (this.ctx = new AudioContext());
    this.master = ac.createGain(); this.master.gain.value = 0.5; this.master.connect(ac.destination);
    const osc = (type) => { const o = ac.createOscillator(); o.type = type; const g = ac.createGain(); g.gain.value = 0; o.connect(g).connect(this.master); o.start(); return { o, g }; };
    this.fan = osc('sawtooth'); this.fan2 = osc('sine'); this.hp = osc('sine'); this.st = osc('triangle');
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const n = ac.createBufferSource(); n.buffer = buf; n.loop = true;
    this.lp = ac.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 200;
    this.ng = ac.createGain(); this.ng.gain.value = 0;
    n.connect(this.lp).connect(this.ng).connect(this.master); n.start();
    this.on = true; this.tick = 0;
  }
  stop() { if (this.ctx) this.ctx.suspend(); this.on = false; }
  bang(strength = 1) {
    if (!this.on) return;
    const ac = this.ctx, s = ac.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160;
    const g = ac.createGain(); const t = ac.currentTime;
    g.gain.setValueAtTime(1.6 * strength, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random(), 0.5);
  }
  click() {
    const ac = this.ctx, o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = 'square'; o.frequency.value = 1800; g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.04);
  }
  update(o, dt) {
    if (!this.on) return;
    const t = this.ctx.currentTime, set = (p, v) => p.setTargetAtTime(v, t, 0.05);
    const n1 = Math.max(0, o.N1) / 60, n2 = o.N2 / 60;
    const p1 = Math.min(1, o.N1pct / 100), p2 = Math.min(1.1, o.N2pct / 100);
    set(this.fan.o.frequency, 20 + n1 * 22); set(this.fan.g.gain, 0.05 * p1 * p1);
    set(this.fan2.o.frequency, 20 + n1 * 44); set(this.fan2.g.gain, 0.04 * p1);
    set(this.hp.o.frequency, 40 + n2 * 14); set(this.hp.g.gain, 0.035 * Math.min(1, p2 * 1.4));
    set(this.st.o.frequency, 200 + n2 * 9); set(this.st.g.gain, o.tStart > 0 ? 0.04 : 0);
    const thr = Math.min(1, Math.max(0, o.Fg) / 140e3);
    set(this.lp.frequency, 120 + 2600 * Math.sqrt(thr) + 500 * p2);
    set(this.ng.gain, 0.03 * p2 + 0.5 * thr + (o.lit ? 0.04 : 0));
    if (o.ignOn) { this.tick += dt; if (this.tick > 0.45) { this.tick = 0; this.click(); } }
  }
}
