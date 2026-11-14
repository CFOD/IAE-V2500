// 2D cutaway renderer. Pure view: reads the simulation output object and draws.
// (A future 3D view can replace this module without touching src/sim.)

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ---- geometry: axial station x [m] vs radius r [m] (engine is ~3.2 m long, 1.6 m fan)
export const P = {
  inletInner: [[-0.78, 0.8], [-0.62, 0.765], [-0.3, 0.79], [0, 0.81]],
  nacelle: [[-0.78, 0.8], [-0.74, 0.9], [-0.45, 1.0], [0.5, 1.04], [2.0, 0.98], [3.55, 0.635]],
  bypOuter: [[0, 0.81], [0.35, 0.81], [1.2, 0.8], [2.4, 0.74], [3.2, 0.66], [3.55, 0.61]],
  bypInner: [[0.4, 0.47], [0.7, 0.54], [1.3, 0.56], [2.4, 0.54], [3.0, 0.52], [3.12, 0.46]],
  coreOuter: [[0.4, 0.47], [0.85, 0.44], [1.15, 0.3], [1.85, 0.25], [1.92, 0.33], [2.18, 0.33], [2.22, 0.3], [2.42, 0.33], [3.0, 0.48], [3.12, 0.44]],
  coreInner: [[0.3, 0.27], [0.45, 0.33], [0.85, 0.36], [1.15, 0.17], [1.85, 0.215], [1.92, 0.17], [2.18, 0.2], [2.22, 0.235], [2.42, 0.25], [3.0, 0.28], [3.12, 0.27], [3.75, 0]],
  spinner: [[-0.45, 0], [-0.3, 0.09], [-0.12, 0.19], [0, 0.24], [0.3, 0.27]],
};
export function rAt(prof, x) {
  if (x <= prof[0][0]) return prof[0][1];
  for (let i = 1; i < prof.length; i++) {
    if (x <= prof[i][0]) return lerp(prof[i - 1][1], prof[i][1], (x - prof[i - 1][0]) / (prof[i][0] - prof[i - 1][0]));
  }
  return prof[prof.length - 1][1];
}

// blade rows
export const ROWS = [];
ROWS.push({ x0: 0.03, x1: 0.3, kind: 'rotor', spool: 1, lo: P.spinner, hi: P.bypOuter, fan: true });
ROWS.push({ x0: 0.56, x1: 0.68, kind: 'stator', lo: P.bypInner, hi: P.bypOuter });
for (let i = 0; i < 4; i++) {
  const x = 0.47 + i * 0.095;
  ROWS.push({ x0: x, x1: x + 0.04, kind: 'rotor', spool: 1, lo: P.coreInner, hi: P.coreOuter });
  ROWS.push({ x0: x + 0.05, x1: x + 0.085, kind: 'stator', lo: P.coreInner, hi: P.coreOuter });
}
ROWS.push({ x0: 1.135, x1: 1.16, kind: 'stator', vsv: true, lo: P.coreInner, hi: P.coreOuter });
for (let i = 0; i < 10; i++) {
  const x = 1.17 + i * 0.068;
  ROWS.push({ x0: x, x1: x + 0.028, kind: 'rotor', spool: 2, lo: P.coreInner, hi: P.coreOuter });
  ROWS.push({ x0: x + 0.036, x1: x + 0.06, kind: 'stator', vsv: i < 3, lo: P.coreInner, hi: P.coreOuter });
}
for (let i = 0; i < 2; i++) {
  const x = 2.225 + i * 0.1;
  ROWS.push({ x0: x, x1: x + 0.04, kind: 'stator', lo: P.coreInner, hi: P.coreOuter });
  ROWS.push({ x0: x + 0.05, x1: x + 0.09, kind: 'rotor', spool: 2, lo: P.coreInner, hi: P.coreOuter });
}
for (let i = 0; i < 5; i++) {
  const x = 2.455 + i * 0.108;
  ROWS.push({ x0: x, x1: x + 0.045, kind: 'stator', lo: P.coreInner, hi: P.coreOuter });
  ROWS.push({ x0: x + 0.055, x1: x + 0.1, kind: 'rotor', spool: 1, lo: P.coreInner, hi: P.coreOuter });
}

/** Temperature [K] to colour. */
const STOPS = [[220, [70, 150, 255]], [300, [60, 170, 245]], [450, [70, 210, 190]], [700, [240, 210, 80]], [1000, [255, 140, 40]], [1400, [255, 70, 40]], [1900, [255, 235, 200]], [2400, [255, 255, 255]]];
export function tempRGB(T) {
  let i = 1;
  while (i < STOPS.length - 1 && T > STOPS[i][0]) i++;
  const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
  const f = clamp((T - t0) / (t1 - t0), 0, 1);
  return [lerp(c0[0], c1[0], f) / 255, lerp(c0[1], c1[1], f) / 255, lerp(c0[2], c1[2], f) / 255];
}
export function tempColor(T, a = 1) {
  let i = 1;
  while (i < STOPS.length - 1 && T > STOPS[i][0]) i++;
  const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
  const f = clamp((T - t0) / (t1 - t0), 0, 1);
  return `rgba(${Math.round(lerp(c0[0], c1[0], f))},${Math.round(lerp(c0[1], c1[1], f))},${Math.round(lerp(c0[2], c1[2], f))},${a})`;
}

export class Cutaway {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.ph1 = 0; this.ph2 = 0;
    this.parts = [];
    for (let i = 0; i < 520; i++) this.parts.push({ path: i % 5 === 0 ? 'core' : 'byp', u: Math.random(), v: Math.random() });
    this.flash = 0; this.shake = 0;
    this.showLabels = true;
    this.t = 0;
  }

  surge(which) { this.flash = 1; this.shake = which === 'fan' ? 10 : 6; this.flashAt = which === 'hpc' ? 1.2 : 0.2; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.cv.getBoundingClientRect();
    this.cv.width = Math.max(100, r.width * dpr); this.cv.height = Math.max(100, r.height * dpr);
    this.w = r.width; this.h = r.height; this.dpr = dpr;
  }

  draw(o, dt) {
    const ctx = this.ctx;
    if (!this.w) this.resize();
    this.t += dt;
    const w = this.w, h = this.h;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const X0 = -1.0, X1 = 5.3;
    const sc = Math.min(w / (X1 - X0), (h - 70) / 2.3);
    const ox = (w - sc * (X1 - X0)) / 2 - X0 * sc, oy = h / 2 + 6;
    let sx = 0, sy = 0;
    if (this.shake > 0.1) { sx = (Math.random() - 0.5) * this.shake; sy = (Math.random() - 0.5) * this.shake; this.shake *= Math.pow(0.002, dt); }
    const tx = (x) => ox + x * sc + sx;
    const ty = (r) => oy - r * sc + sy;
    this.tx = tx; this.ty = ty; this.sc = sc;

    // rotor phases (visual speed saturates so blades stay readable)
    const v1 = Math.sign(o.N1) * Math.pow(Math.abs(o.N1pct) / 100, 0.6) * 9;
    const v2 = Math.pow(Math.abs(o.N2pct) / 100, 0.6) * 14;
    this.ph1 = (this.ph1 + v1 * dt) % 1; this.ph2 = (this.ph2 + v2 * dt) % 1;

    const band = (lo, hi, xa, xb, sign) => {
      const p = new Path2D();
      const n = 40;
      for (let i = 0; i <= n; i++) { const x = lerp(xa, xb, i / n); const y = ty(sign * rAt(hi, x)); i ? p.lineTo(tx(x), y) : p.moveTo(tx(x), y); }
      for (let i = n; i >= 0; i--) { const x = lerp(xa, xb, i / n); p.lineTo(tx(x), ty(sign * rAt(lo, x))); }
      p.closePath();
      return p;
    };
    const ZERO = [[-9, 0], [9, 0]];

    // ---- exhaust plume
    const thr = clamp(o.Fg / 150e3, 0, 1);
    if (o.W8 > 0.5) {
      const len = 0.5 + 1.5 * Math.sqrt(thr);
      const g = ctx.createLinearGradient(tx(3.1), 0, tx(3.6 + len), 0);
      g.addColorStop(0, tempColor(o.T5, 0.55)); g.addColorStop(1, tempColor(o.T5, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(tx(3.12), ty(0.44)); ctx.lineTo(tx(3.6 + len), ty(0.3)); ctx.lineTo(tx(3.6 + len), ty(-0.3)); ctx.lineTo(tx(3.12), ty(-0.44)); ctx.fill();
      const g2 = ctx.createLinearGradient(tx(3.5), 0, tx(3.6 + len * 1.1), 0);
      g2.addColorStop(0, tempColor(o.T13, 0.22 + 0.2 * thr)); g2.addColorStop(1, tempColor(o.T13, 0));
      ctx.fillStyle = g2;
      for (const s of [1, -1]) { ctx.beginPath(); ctx.moveTo(tx(3.55), ty(s * 0.61)); ctx.lineTo(tx(3.6 + len * 1.1), ty(s * 0.58)); ctx.lineTo(tx(3.6 + len * 1.1), ty(s * 0.32)); ctx.lineTo(tx(3.2), ty(s * 0.46)); ctx.fill(); }
    }
    // torching: unburnt fuel burning in the tailpipe
    if (o.wfUnburnt > 0.01 || (o.lit && o.pool > 0.02)) {
      for (let i = 0; i < 14; i++) {
        const x = 3.1 + Math.random() * 1.2, r = (Math.random() - 0.5) * 0.5;
        ctx.fillStyle = `rgba(255,${120 + Math.random() * 100 | 0},30,${0.25 * Math.random()})`;
        ctx.beginPath(); ctx.arc(tx(x), ty(r), sc * (0.05 + Math.random() * 0.12), 0, 7); ctx.fill();
      }
    }

    // ---- gas paths coloured by temperature
    const grad = (stops) => { const g = ctx.createLinearGradient(tx(-0.8), 0, tx(3.6), 0); for (const [x, T] of stops) g.addColorStop(clamp((x + 0.8) / 4.4, 0, 1), tempColor(T, 0.5)); return g; };
    const gB = grad([[-0.8, o.T2], [0.05, o.T2], [0.32, o.T13], [3.6, o.T13]]);
    const gC = grad([[0.3, o.T2], [0.45, o.T2], [0.85, o.T25], [1.15, o.T25], [1.85, o.T3], [1.95, o.T3], [2.02, o.lit ? Math.max(o.T4, 1500) : o.T4], [2.2, o.T4], [2.42, o.T45], [3.0, o.T5], [3.6, o.T5]]);
    for (const s of [1, -1]) {
      ctx.fillStyle = gB;
      ctx.fill(band(s > 0 ? ZERO : ZERO, P.inletInner, -0.78, 0, s));
      ctx.fill(band(P.spinner, P.bypOuter, 0, 0.4, s));
      ctx.fill(band(P.bypInner, P.bypOuter, 0.4, 3.55, s));
      ctx.fillStyle = gC;
      ctx.fill(band(P.coreInner, P.coreOuter, 0.4, 3.12, s));
    }

    // ---- flame
    if (o.lit) {
      const inten = clamp(o.farBurn / 0.03, 0.15, 1.3);
      ctx.globalCompositeOperation = 'lighter';
      for (const s of [1, -1]) for (let i = 0; i < 9; i++) {
        const x = 1.97 + Math.random() * 0.17 * inten, r = s * (0.25 + (Math.random() - 0.5) * 0.07);
        const rad = sc * (0.03 + 0.05 * Math.random()) * (0.6 + 0.6 * inten);
        const g = ctx.createRadialGradient(tx(x), ty(r), 0, tx(x), ty(r), rad);
        g.addColorStop(0, `rgba(255,240,200,${0.5 * inten})`); g.addColorStop(0.4, `rgba(255,150,40,${0.35 * inten})`); g.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tx(x), ty(r), rad, 0, 7); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // ---- flow particles
    const vB = Math.sign(o.Wbypass) * (0.15 + 2.6 * Math.sqrt(Math.abs(o.Wbypass) / 315)) * (Math.abs(o.Wbypass) > 0.5 ? 1 : 0);
    const vC = Math.sign(o.Wcore) * (0.15 + 2.6 * Math.sqrt(Math.abs(o.Wcore) / 70)) * (Math.abs(o.Wcore) > 0.05 ? 1 : 0);
    ctx.lineWidth = 1.3;
    for (const p of this.parts) {
      const isC = p.path === 'core';
      const v = isC ? vC : vB;
      const span = isC ? 4.3 : 4.6;
      p.u += (v * dt) / span;
      if (p.u > 1) { p.u -= 1; p.v = Math.random(); } else if (p.u < 0) { p.u += 1; p.v = Math.random(); }
      const x = -0.9 + p.u * span;
      let lo, hi, T;
      if (x < 0) { lo = 0; hi = rAt(P.inletInner, Math.max(x, -0.78)) * (x < -0.78 ? 1 + (-0.78 - x) * 0.5 : 1); T = o.T2; if (isC) hi *= 0.42; else lo = hi * 0.42; }
      else if (x < 0.4) { lo = rAt(P.spinner, x); hi = 0.81; T = o.T2; if (isC) hi = lerp(lo, hi, 0.36); else lo = lerp(lo, hi, 0.36); }
      else if (isC) { if (x > 3.4) continue; lo = rAt(P.coreInner, x); hi = x > 3.12 ? 0.44 : rAt(P.coreOuter, x); T = x < 1.0 ? o.T25 : x < 1.9 ? o.T3 : x < 2.3 ? o.T4 : x < 2.45 ? o.T45 : o.T5; }
      else { if (x > 3.7) continue; lo = x > 3.12 ? 0.46 : rAt(P.bypInner, x); hi = rAt(P.bypOuter, Math.min(x, 3.55)); T = o.T13; }
      const s = p.v < 0.5 ? 1 : -1;
      const r = s * lerp(lo, hi, 0.08 + 0.84 * ((p.v * 2) % 1));
      ctx.strokeStyle = tempColor(T + 150, 0.75);
      const l = clamp(Math.abs(v) * 0.03, 0.004, 0.09) * Math.sign(v || 1);
      ctx.beginPath(); ctx.moveTo(tx(x), ty(r)); ctx.lineTo(tx(x - l), ty(r)); ctx.stroke();
    }

    // ---- structure
    const solid = (path, fill, stroke = '#5b6b80') => { ctx.fillStyle = fill; ctx.fill(path); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(path); };
    for (const s of [1, -1]) {
      const nac = new Path2D();
      const pts = [...P.inletInner.map(([x, r]) => [x, r]), ...P.bypOuter.slice(1)];
      pts.forEach(([x, r], i) => (i ? nac.lineTo(tx(x), ty(s * r)) : nac.moveTo(tx(x), ty(s * r))));
      [...P.nacelle].reverse().forEach(([x, r]) => nac.lineTo(tx(x), ty(s * r)));
      nac.closePath();
      solid(nac, '#1c2530');
      solid(band(P.coreOuter, P.bypInner, 0.4, 3.12, s), '#222d3a');
      solid(band(ZERO, P.coreInner, 0.3, 3.75, s), '#18202a');
      // spinner
      solid(band(ZERO, P.spinner, -0.45, 0.3, s), '#2a3644');
    }
    // shafts: LP (through the middle) and HP (drum between HPC and HPT)
    ctx.fillStyle = '#3d6ea8'; ctx.fillRect(tx(0.1), ty(0.045), sc * 2.95, sc * 0.09);
    ctx.fillStyle = '#b07a2a';
    ctx.fillRect(tx(1.15), ty(0.115), sc * 1.27, sc * 0.05); ctx.fillRect(tx(1.15), ty(-0.065), sc * 1.27, sc * 0.05);
    // discs
    const disc = (x0, x1, rTop, col) => { ctx.fillStyle = col; ctx.fillRect(tx(x0), ty(rTop), (x1 - x0) * sc, rTop * 2 * sc); };

    // ---- blade rows
    for (const row of ROWS) {
      const xm = (row.x0 + row.x1) / 2;
      const lo = rAt(row.lo, xm), hi = rAt(row.hi, xm) - (row.kind === 'rotor' ? 0.006 : 0);
      for (const s of [1, -1]) {
        const ya = ty(s * lo), yb = ty(s * hi);
        const top = Math.min(ya, yb), ht = Math.abs(yb - ya);
        if (row.kind === 'rotor') {
          const col = row.spool === 1 ? ['#5d93d6', '#a9cdf5'] : ['#d09a3c', '#ffd98a'];
          ctx.fillStyle = col[0];
          ctx.fillRect(tx(row.x0), top, (row.x1 - row.x0) * sc, ht);
          // scrolling highlights = blades sweeping past the section plane
          const ph = row.spool === 1 ? this.ph1 : this.ph2;
          const pitch = row.fan ? ht / 4 : Math.max(ht / 3, 7);
          ctx.save(); ctx.beginPath(); ctx.rect(tx(row.x0), top, (row.x1 - row.x0) * sc, ht); ctx.clip();
          ctx.fillStyle = col[1]; ctx.globalAlpha = 0.75;
          const off = ((s > 0 ? 1 - ph : ph) % 1) * pitch;
          for (let y = top - pitch + off; y < top + ht; y += pitch) ctx.fillRect(tx(row.x0), y, (row.x1 - row.x0) * sc, pitch * 0.35);
          ctx.restore();
          // disc under the rotor
          if (!row.fan) { ctx.fillStyle = row.spool === 1 ? '#34587f' : '#7a5a24'; const rr = row.spool === 1 ? 0.045 : 0.115; ctx.fillRect(tx(xm) - 2, s > 0 ? ty(lo) : ty(-rr), 4, (lo - rr) * sc); }
        } else {
          ctx.fillStyle = row.vsv ? '#7fe0b0' : '#8794a6';
          if (row.vsv) {
            // variable stators: draw rotated to the commanded angle
            const ang = (o.vsv * Math.PI) / 180;
            ctx.save(); ctx.translate(tx(xm), top + ht / 2); ctx.transform(1, 0, Math.sin(ang) * 0.5 * s, 1, 0, 0);
            ctx.fillRect(-(row.x1 - row.x0) * sc * 0.5, -ht / 2, (row.x1 - row.x0) * sc * Math.max(0.35, Math.cos(ang)), ht); ctx.restore();
          } else ctx.fillRect(tx(row.x0), top, (row.x1 - row.x0) * sc, ht);
        }
      }
    }
    // fan disc
    disc(0.06, 0.28, 0.045, '#34587f');

    // fuel nozzles + igniter
    for (const s of [1, -1]) {
      ctx.strokeStyle = o.wf > 0.001 ? '#ffd166' : '#667'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tx(1.93), ty(s * 0.4)); ctx.lineTo(tx(1.95), ty(s * 0.27)); ctx.stroke();
    }
    if (o.ignOn && Math.floor(this.t * 4) % 2 === 0) { ctx.fillStyle = '#9fe8ff'; ctx.beginPath(); ctx.arc(tx(2.0), ty(0.31), 3.5, 0, 7); ctx.fill(); }

    // ---- bleed puffs
    const puff = (x, r, amt, col) => { if (amt < 0.02) return; ctx.strokeStyle = col; ctx.lineWidth = 1.5 + 2 * amt; ctx.globalAlpha = 0.5 + 0.4 * Math.sin(this.t * 20); for (const s of [1, -1]) { ctx.beginPath(); ctx.moveTo(tx(x), ty(s * r)); ctx.lineTo(tx(x + 0.05), ty(s * (r + 0.07))); ctx.stroke(); } ctx.globalAlpha = 1; };
    puff(0.9, 0.44, o.Wb25 > 0.05 ? o.b25 : 0, '#7fd4ff');
    puff(1.6, 0.27, o.Wb7 > 0.01 ? 0.6 : 0, '#ffe08a');
    puff(1.8, 0.26, o.Wb10 > 0.01 ? 0.8 : 0, '#ffb070');

    // ---- surge flash
    if (this.flash > 0.02) {
      const x = this.flashAt, g = ctx.createRadialGradient(tx(x), oy, 0, tx(x), oy, sc * 1.1);
      g.addColorStop(0, `rgba(255,220,150,${0.8 * this.flash})`); g.addColorStop(1, 'rgba(255,90,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      this.flash *= Math.pow(0.001, dt);
    }

    // ---- labels
    if (this.showLabels) {
      ctx.font = "700 11px 'B612 Mono', Consolas, monospace"; ctx.textAlign = 'center';
      const comp = [['FAN', 0.16], ['LPC', 0.65], ['HPC', 1.5], ['COMB', 2.05], ['HPT', 2.32], ['LPT', 2.72]];
      ctx.fillStyle = '#e6eef8';
      for (const [n, x] of comp) ctx.fillText(n, tx(x), oy + 4);
      const C = (T) => `${(T - 273.15).toFixed(0)}°C`, B = (p) => `${(p / 1e5).toFixed(2)} bar`;
      const st = [
        ['2 INLET', -0.35, 0.5, o.T2, o.P2, 1], ['13 BYPASS', 1.3, 0.68, o.T13, o.P13, 1], ['2.5 LPC EXIT', 1.0, 0.36, o.T25, o.P25, -1],
        ['3 HPC EXIT', 1.88, 0.27, o.T3, o.P3, 1], ['4 TURB INLET', 2.2, 0.29, o.T4, o.P4, -1], ['4.9 LPT EXIT', 3.05, 0.38, o.T5, o.P5, 1],
      ];
      const yTop = 34, yBot = h - 30;
      st.forEach(([name, x, r, T, Pp, side]) => {
        const px = tx(x), py = ty(side * r), ly = side > 0 ? yTop : yBot;
        ctx.strokeStyle = 'rgba(160,180,200,0.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, ly + (side > 0 ? 8 : -22)); ctx.stroke();
        ctx.fillStyle = '#8fa3ba'; ctx.fillText(name, px, ly - (side > 0 ? 14 : 16));
        ctx.fillStyle = tempColor(Math.max(T, 500) + 200, 1); ctx.fillText(`${C(T)}  ${B(Pp)}`, px, ly - (side > 0 ? 0 : 2));
      });
    }
  }
}
