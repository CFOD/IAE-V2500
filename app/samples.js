// Sample-based engine sound: plays real recordings, pitch-shifted and crossfaded by engine
// state, the way flight simulators do. Used when recordings are present in app/sounds/;
// otherwise the synthesiser in audio.js is used.
//
// Two ways to describe a set of recordings:
//   app/sounds/sounds.json   this project's own format (see docs/SOUND.md)
//   app/sounds/sound.cfg     a Flight Simulator X / Prepar3D jet sound pack, read directly

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
/** Piecewise-linear lookup through [[x, y], ...] sorted by x. */
export function curve(pts, x) {
  if (!pts || !pts.length) return 1;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return pts[pts.length - 1][1];
}

/** Parse an INI-style sound.cfg into { section: { key: value } } with lower-cased names. */
export function parseIni(text) {
  const out = {}; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)(\/\/|;).*$/, '').trim(); if (!line) continue;
    const m = line.match(/^\[(.+)\]$/); if (m) { cur = out[m[1].trim().toLowerCase()] = {}; continue; }
    const eq = line.indexOf('='); if (eq > 0 && cur) cur[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
  }
  return out;
}
const pairs = (s) => { const n = (s || '').split(',').map(Number).filter((v) => Number.isFinite(v)); const p = []; for (let i = 0; i + 1 < n.length; i += 2) p.push([n[i], n[i + 1]]); return p.sort((a, b) => a[0] - b[0]); };

/**
 * Convert an FSX / P3D jet sound.cfg into this project's manifest.
 * [SOUND_ENGINE] names the entry section for each kind of sound; each entry is a chain of
 * sections joined by `link=`, each with a wave file, rparams (speed %, pitch) and vparams
 * (speed %, volume 0-100). Jet whine follows N1; combustion and non-combustion follow N2.
 * viewpoint=1 entries are cockpit sounds and are skipped: this is an outside view.
 */
export function manifestFromFsx(text) {
  const ini = parseIni(text), eng = ini.sound_engine || {}, layers = [], shots = {};
  const chain = (start) => { const list = []; const seen = new Set(); let name = (start || '').toLowerCase(); while (name && ini[name] && !seen.has(name)) { seen.add(name); list.push(ini[name]); name = (ini[name].link || '').toLowerCase(); } return list; };
  const wav = (f) => (/\.[a-z0-9]{2,4}$/i.test(f) ? f : `${f}.wav`);
  const ext = (sec) => (sec.viewpoint || '2').trim() !== '1';
  const loops = (key, driver, when) => { for (const sec of chain(eng[key])) if (sec.filename && ext(sec)) layers.push({ file: wav(sec.filename), driver, when, pitch: pairs(sec.rparams), volume: pairs(sec.vparams).map(([x, v]) => [x, v / 100]) }); };
  loops('eng1_combustion', 'n2', 'lit');
  loops('eng1_jet_whine', 'n1', 'turning');
  loops('eng1_non_combustion', 'n2', 'unlit');
  const one = (key, ev) => { const sec = chain(eng[key]).find((s) => s.filename && ext(s)); if (sec) shots[ev] = { file: wav(sec.filename), gain: 1 }; };
  one('eng1_starter', 'starter'); one('eng1_combustion_start', 'lightoff'); one('eng1_shutdown', 'shutdown');
  return { name: 'Flight simulator sound pack', layers, shots, synth: 'events' };
}

export class SamplePlayer {
  constructor(ctx, bus) { this.ctx = ctx; this.bus = bus; this.layers = []; this.shots = {}; this.ready = false; this.name = ''; this.synth = 'off'; this.missing = []; this._prev = {}; }

  /** Look for a manifest in `base` and load every recording it lists. Resolves true if any loaded. */
  async load(base = 'sounds/') {
    let manifest = null;
    try { const r = await fetch(base + 'sounds.json'); if (r.ok) manifest = await r.json(); } catch (e) { /* none */ }
    if (!manifest) { try { const r = await fetch(base + 'sound.cfg'); if (r.ok) manifest = manifestFromFsx(await r.text()); } catch (e) { /* none */ } }
    if (!manifest) return false;
    const buf = async (file) => { try { const r = await fetch(base + file); if (!r.ok) throw new Error(String(r.status)); return await this.ctx.decodeAudioData(await r.arrayBuffer()); } catch (e) { this.missing.push(file); return null; } };
    for (const L of manifest.layers || []) {
      const b = await buf(L.file); if (!b) continue;
      const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
      if (L.loopStart != null) { src.loopStart = L.loopStart; src.loopEnd = L.loopEnd ?? b.duration; }
      const g = this.ctx.createGain(); g.gain.value = 0; src.connect(g).connect(this.bus); src.start(0, Math.random() * b.duration);
      this.layers.push({ ...L, src, g });
    }
    for (const [ev, s] of Object.entries(manifest.shots || {})) { const b = await buf(s.file); if (b) this.shots[ev] = { ...s, buffer: b }; }
    this.name = manifest.name || 'Recordings'; this.synth = manifest.synth || 'events';
    this.ready = this.layers.length > 0 || Object.keys(this.shots).length > 0;
    return this.ready;
  }

  play(ev, gainK = 1) {
    const s = this.shots[ev]; if (!s) return false;
    const src = this.ctx.createBufferSource(); src.buffer = s.buffer; const g = this.ctx.createGain(); g.gain.value = (s.gain ?? 1) * gainK;
    src.connect(g).connect(this.bus); src.start(); (this._live ||= {})[ev] = { src, g };
    src.onended = () => { if (this._live[ev] && this._live[ev].src === src) delete this._live[ev]; };
    return true;
  }
  stopShot(ev, fade = 0.4) { const l = this._live && this._live[ev]; if (!l) return; const t = this.ctx.currentTime; l.g.gain.setTargetAtTime(0, t, fade / 3); try { l.src.stop(t + fade); } catch (e) { /* already stopped */ } delete this._live[ev]; }
  has(ev) { return !!this.shots[ev]; }

  /** @param o simulation outputs; listener {front, near} as in audio.js */
  update(o, listener) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, x = { n1: Math.abs(o.N1pct), n2: o.N2pct, thrust: Math.max(0, o.thrust) / 1000, epr: o.epr, fuel: o.wf * 3600 };
    for (const L of this.layers) {
      const v = x[L.driver || 'n1'] ?? 0;
      let gate = 1;
      if (L.when === 'lit') gate = o.lit ? 1 : 0; else if (L.when === 'unlit') gate = o.lit ? 0 : 1; else if (L.when === 'starter') gate = o.tStart > 0 ? 1 : 0; else if (L.when === 'reverse') gate = o.rev || 0;
      const dir = L.pos === 'front' ? 0.4 + 0.9 * listener.front : L.pos === 'rear' ? 0.4 + 0.9 * (1 - listener.front) : 1;
      L.g.gain.setTargetAtTime(clamp(curve(L.volume, v) * (L.gain ?? 1) * gate * dir * listener.near, 0, 4), t, L.when ? 0.25 : 0.08);
      L.src.playbackRate.setTargetAtTime(clamp(curve(L.pitch, v), 0.05, 4), t, 0.05);
    }
    // events from state changes
    const p = this._prev, starter = o.tStart > 0, running = o.lit && o.N2pct > 50;
    if (starter && !p.starter) this.play('starter');
    if (!starter && p.starter && !o.lit) this.stopShot('starter');
    if (o.lit && !p.lit && o.N2pct < 50) this.play('lightoff');
    if (!o.lit && p.lit && p.running) this.play('shutdown');
    if (o.lit && this._live && this._live.shutdown) this.stopShot('shutdown', 0.3);
    this._prev = { starter, lit: o.lit, running };
  }
}
