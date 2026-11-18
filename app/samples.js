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
  constructor(ctx, bus) { this.ctx = ctx; this.bus = bus; this.layers = []; this.tracks = []; this.shots = {}; this.mute = new Set(); this.ready = false; this.name = ''; this.synth = 'off'; this.missing = []; this._prev = {}; }

  /**
   * Look for a manifest and load every recording it lists. Resolves true if any loaded.
   * Reads from `base` on the server, or, given `files` (a FileList / array of File, as picked with a
   * folder chooser in the browser), straight from the player's own disk: nothing is uploaded.
   */
  async load(base = 'sounds/', files = null, onProgress = null, query = '') {
    const local = files ? new Map([...files].map((f) => [f.name.toLowerCase(), f])) : null;
    const get = async (name) => {
      if (local) { const f = local.get(name.split(/[\\/]/).pop().toLowerCase()); if (!f) throw new Error('missing'); return f; }
      const r = await fetch(base + name + query, { cache: 'no-cache' }); if (!r.ok) throw new Error(String(r.status)); return r;
    };
    let manifest = null;
    try { manifest = JSON.parse(await (await get('sounds.json')).text()); } catch (e) { /* none */ }
    if (!manifest) { try { manifest = manifestFromFsx(await (await get('sound.cfg')).text()); } catch (e) { /* none */ } }
    if (!manifest) return false;
    // fetch and decode every recording in parallel (tens of MB on a website), reporting progress
    const wanted = [...new Set([...(manifest.layers || []).map((L) => L.file), ...Object.values(manifest.shots || {}).map((x) => x.file)])];
    let done = 0; const report = () => onProgress && onProgress(done, wanted.length);
    report();
    const decoded = new Map(await Promise.all(wanted.map(async (file) => {
      let b = null; try { b = await this.ctx.decodeAudioData(await (await get(file)).arrayBuffer()); } catch (e) { this.missing.push(file); }
      done++; report(); return [file, b];
    })));
    const buf = async (file) => decoded.get(file) || null;
    for (const L of manifest.layers || []) {
      const b = await buf(L.file); if (!b) continue;
      if (L.track) { // a long recording kept in step with the engine (see update)
        const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.bus);
        this.tracks.push({ ...L, dir: L.pos, track: [...L.track].sort((a, c) => a[0] - c[0]), buffer: b, g, active: false, src: null, sg: null, pos: 0 });
        continue;
      }
      const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
      if (L.loopStart != null) { src.loopStart = L.loopStart; src.loopEnd = L.loopEnd ?? b.duration; }
      const g = this.ctx.createGain(); g.gain.value = 0; src.connect(g).connect(this.bus); src.start(0, Math.random() * b.duration);
      this.layers.push({ ...L, src, g });
    }
    for (const [ev, s] of Object.entries(manifest.shots || {})) { const b = await buf(s.file); if (b) this.shots[ev] = { ...s, buffer: b }; }
    this.name = manifest.name || 'Recordings'; this.synth = manifest.synth || 'events';
    for (const ev of manifest.mute || []) this.mute.add(ev); // synthesised events the recordings already contain
    this.ready = this.layers.length > 0 || this.tracks.length > 0 || Object.keys(this.shots).length > 0;
    return this.ready;
  }

  /** Stop and disconnect everything (before loading a different set of recordings). */
  dispose() {
    for (const L of this.layers) { try { L.src.stop(); } catch (e) { /* stopped */ } L.g.disconnect(); }
    for (const T of this.tracks) { try { T.src && T.src.stop(); } catch (e) { /* stopped */ } T.g.disconnect(); }
    for (const l of Object.values(this._live || {})) { try { l.src.stop(); } catch (e) { /* stopped */ } }
    this.layers = []; this.tracks = []; this.shots = {}; this.ready = false;
  }

  play(ev, gainK = 1) {
    if (this.mute.has(ev)) return true;
    const s = this.shots[ev]; if (!s) return false;
    const src = this.ctx.createBufferSource(); src.buffer = s.buffer; const g = this.ctx.createGain(); g.gain.value = (s.gain ?? 1) * gainK;
    src.connect(g).connect(this.bus); src.start(); (this._live ||= {})[ev] = { src, g };
    src.onended = () => { if (this._live[ev] && this._live[ev].src === src) delete this._live[ev]; };
    return true;
  }
  stopShot(ev, fade = 0.4) { const l = this._live && this._live[ev]; if (!l) return; const t = this.ctx.currentTime; l.g.gain.setTargetAtTime(0, t, fade / 3); try { l.src.stop(t + fade); } catch (e) { /* already stopped */ } delete this._live[ev]; }
  has(ev) { return !!this.shots[ev] || this.mute.has(ev); }

  // ---- track layers: a whole start or spool-down recording, followed by engine speed.
  // `track: [[driver value, seconds into the file], ...]` says where in the recording each engine speed
  // is. The player keeps the play head near that point: it runs a little faster or slower (+-25 %) to
  // keep up, and when it gets two or three seconds away (the engine holding speed while motoring,
  // or spooling down faster than the recording) it crossfades to the right place.
  _trackAt(T, v) { return curve(T.track, v); }
  _trackSource(T, at, fade = 0.25) {
    const t = this.ctx.currentTime;
    if (T.src) { const old = T.src, og = T.sg; og.gain.setTargetAtTime(0, t, fade / 3); try { old.stop(t + fade * 1.5); } catch (e) { /* gone */ } }
    const src = this.ctx.createBufferSource(); src.buffer = T.buffer; const sg = this.ctx.createGain(); sg.gain.value = 0;
    src.connect(sg).connect(T.g); sg.gain.setTargetAtTime(1, t, fade / 3);
    const start = clamp(at, 0, Math.max(0, T.buffer.duration - 0.1)); src.start(t, start);
    T.src = src; T.sg = sg; T.pos = start;
  }
  _trackStop(T, fade = 0.6) {
    if (!T.active) return; T.active = false; const t = this.ctx.currentTime;
    T.g.gain.setTargetAtTime(0, t, fade / 3); if (T.src) { try { T.src.stop(t + fade * 2); } catch (e) { /* gone */ } } T.src = null;
  }
  _updateTracks(o, x, listener, dt) {
    let duck = 0;
    const p = this._prev, n2 = o.N2pct, starter = o.tStart > 0;
    for (const T of this.tracks) {
      const v = x[T.driver || 'n2'] ?? 0;
      if (T.when === 'start') {
        if (!T.active && starter && n2 < 35) { T.active = true; this._trackSource(T, this._trackAt(T, v), 0.15); }
        if (T.active && ((!starter && !o.lit) || n2 >= (T.until ?? 60))) this._trackStop(T, 1.2);
      } else if (T.when === 'shutdown') {
        if (!T.active && p.lit && !o.lit && (p.n2 || 0) > 40) { T.active = true; this._trackSource(T, this._trackAt(T, v), 0.15); }
        if (T.active && (o.lit || n2 < (T.until ?? 0.8))) this._trackStop(T, o.lit ? 0.3 : 1.5);
      }
      if (!T.active || !T.src) continue;
      const target = this._trackAt(T, v), err = target - T.pos;
      if (err > 2.2 || err < -3) this._trackSource(T, target - 0.4, 0.7);   // long crossfade: a jump back is not heard
      else {
        const rate = clamp(1 + 0.5 * err, 0.6, 1.25);
        T.src.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.1); T.pos += rate * dt;
      }
      const vol = curve(T.volume, v);
      const dir = T.dir === 'front' ? 0.4 + 0.9 * listener.front : T.dir === 'rear' ? 0.4 + 0.9 * (1 - listener.front) : 1;
      T.g.gain.setTargetAtTime(clamp(vol * (T.gain ?? 1) * dir * listener.near, 0, 4), this.ctx.currentTime, 0.12);
      if (T.duck !== false) duck = Math.max(duck, clamp(vol, 0, 1));
    }
    return duck;
  }

  /** @param o simulation outputs; listener {front, near} as in audio.js */
  update(o, listener) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, x = { n1: Math.abs(o.N1pct), n2: o.N2pct, thrust: Math.max(0, o.thrust) / 1000, epr: o.epr, fuel: o.wf * 3600 };
    const dt = clamp(t - (this._t ?? t), 0, 0.25); this._t = t;
    const duck = this.tracks.length ? this._updateTracks(o, x, listener, dt) : 0;
    for (const L of this.layers) {
      const v = x[L.driver || 'n1'] ?? 0;
      let gate = 1;
      if (L.when === 'lit') gate = o.lit ? 1 : 0; else if (L.when === 'unlit') gate = o.lit ? 0 : 1; else if (L.when === 'starter') gate = o.tStart > 0 ? 1 : 0;
      else if (L.when === 'coast') gate = !o.lit && !(o.tStart > 0) ? 1 : 0;   // spooling down: no flame, no starter
      else if (L.when === 'reverse') gate = o.rev || 0;
      const dir = L.pos === 'front' ? 0.4 + 0.9 * listener.front : L.pos === 'rear' ? 0.4 + 0.9 * (1 - listener.front) : 1;
      const ducked = L.duck === false ? 1 : 1 - duck;   // loops step back while a start or spool-down recording plays
      L.g.gain.setTargetAtTime(clamp(curve(L.volume, v) * (L.gain ?? 1) * gate * dir * ducked * listener.near, 0, 4), t, L.when ? 0.25 : 0.08);
      L.src.playbackRate.setTargetAtTime(clamp(curve(L.pitch, v), 0.05, 4), t, 0.05);
    }
    // events from state changes
    const p = this._prev, starter = o.tStart > 0, running = o.lit && o.N2pct > 50;
    if (starter && !p.starter) this.play('starter');
    if (!starter && p.starter && !o.lit) this.stopShot('starter');
    if (o.lit && !p.lit && o.N2pct < 50) this.play('lightoff');
    if (!o.lit && p.lit && p.running) this.play('shutdown');
    if (o.lit && this._live && this._live.shutdown) this.stopShot('shutdown', 0.3);
    this._prev = { starter, lit: o.lit, running, n2: o.N2pct };
  }
}
