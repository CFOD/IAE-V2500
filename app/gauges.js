// Instrument readouts and plots, drawn on canvas in the app's visual language.
import { mapSpeedLine } from '../src/sim/components.js';

const INK = '#f3f4f6', INK2 = 'rgba(243,244,246,0.62)', INK3 = 'rgba(243,244,246,0.36)', TRACK = 'rgba(255,255,255,0.11)', LINE = 'rgba(255,255,255,0.08)';
const WARN = '#ffb547', BAD = '#ff5d55', OK = '#7fe3a9';
const F = (w, px) => `${w} ${px}px Inter, system-ui, sans-serif`;

function fit(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), r = cv.getBoundingClientRect();
  const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
  return [ctx, r.width, r.height];
}

function gauge(ctx, cx, cy, rad, o) {
  const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
  const ang = (v) => a0 + ((Math.min(Math.max(v, o.min), o.max) - o.min) / (o.max - o.min)) * (a1 - a0);
  const col = o.red != null && o.value >= o.red ? BAD : o.amber != null && o.value >= o.amber ? WARN : INK;
  ctx.lineCap = 'round'; ctx.lineWidth = 3;
  ctx.strokeStyle = TRACK; ctx.beginPath(); ctx.arc(cx, cy, rad, a0, a1); ctx.stroke();
  if (o.red != null) { ctx.strokeStyle = BAD; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.arc(cx, cy, rad, ang(o.red), a1); ctx.stroke(); ctx.lineCap = 'round'; }
  if (o.value > o.min) { ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(cx, cy, rad, a0, ang(o.value)); ctx.stroke(); }
  if (o.bug != null) { const a = ang(o.bug); ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (rad + 7), cy + Math.sin(a) * (rad + 7), 2.4, 0, 7); ctx.fill(); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = col; ctx.font = F(620, Math.max(11, Math.round(rad * 0.5))); ctx.fillText(o.text, cx, cy - 1);
  ctx.fillStyle = INK3; ctx.font = F(540, 11); ctx.fillText(o.label, cx, cy + rad * 0.72 + 8);
}

/** Dock readouts: four gauges and three numeric tiles. */
export function drawEcam(cv, o, f, peaks, egtRed = 635) {
  const [ctx, w, h] = fit(cv);
  const egt = o.egt - 273.15;
  const tiles = w > 780 ? 3 : w > 560 ? 2 : w > 440 ? 1 : 0, tw = tiles ? 118 : 0;
  const gw = (w - tiles * tw - 18) / 4, rad = Math.max(8, Math.min(gw / 2 - 9, h / 2 - 13)), cy = h / 2 - 7;
  if (w < 120) return;
  const x = (i) => 18 + gw * (i + 0.5);
  gauge(ctx, x(0), cy, rad, { min: 1, max: 2.1, value: o.epr, bug: f.master ? f.eprCmd : null, label: 'EPR', text: o.epr.toFixed(3) });
  gauge(ctx, x(1), cy, rad, { min: 0, max: 800, value: egt, amber: 610, red: egtRed, label: 'EGT °C', text: egt.toFixed(0) });
  gauge(ctx, x(2), cy, rad, { min: 0, max: 110, value: o.N1pct, red: 100, label: 'N1 %', text: o.N1pct.toFixed(1) });
  gauge(ctx, x(3), cy, rad, { min: 0, max: 110, value: o.N2pct, red: 100, label: 'N2 %', text: o.N2pct.toFixed(1) });
  const data = [['Thrust', (o.thrust / 1000).toFixed(1), 'kN', `${(o.thrust / 4.4482216).toFixed(0)} lbf`], ['Fuel flow', (o.wf * 3600).toFixed(0), 'kg/h', `${o.fuelUsed.toFixed(1)} kg used`], ['TSFC', o.sfc > 0 ? o.sfc.toFixed(3) : '—', '', 'lb/lbf·h']];
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  for (let i = 0; i < tiles; i++) {
    const [label, val, unit, sub] = data[i], tx = w - (tiles - i) * tw + 6;
    ctx.fillStyle = INK3; ctx.font = F(540, 11); ctx.fillText(label, tx, h / 2 - 24);
    ctx.fillStyle = INK; ctx.font = F(620, 22); ctx.fillText(val, tx, h / 2 + 4);
    const vw = ctx.measureText(val).width; ctx.fillStyle = INK2; ctx.font = F(520, 11); ctx.fillText(unit, tx + vw + 4, h / 2 + 4);
    ctx.fillStyle = INK3; ctx.fillText(sub, tx, h / 2 + 22);
  }
}

const trails = { fan: [], lpc: [], hpc: [] };
export function drawMaps(cv, eng) {
  const [ctx, w, h] = fit(cv);
  const o = eng.out, cfg = eng.cfg;
  const defs = [['Fan', 'fan', 360, 2.3], ['LP compressor', 'lpc', 85, 3.2], ['HP compressor', 'hpc', 85, 18]];
  const cols = w > 720 ? 3 : 1, rowsN = Math.ceil(3 / cols), pw = w / cols, ph = h / rowsN;
  defs.forEach(([title, key, wMax, prMax], i) => {
    const m = cfg[key], x0 = (i % cols) * pw + 4, y0 = Math.floor(i / cols) * ph + 24, pwi = pw - 8, phi = ph - 44;
    const X = (wc) => x0 + (wc / wMax) * pwi, Y = (pr) => y0 + phi - ((pr - 1) / (prMax - 1)) * phi;
    ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + phi); ctx.lineTo(x0 + pwi, y0 + phi); ctx.stroke();
    const st = o[key], sm = st.xs > 0 ? (100 * (st.xs - st.x)) / st.xs : 0;
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = INK; ctx.font = F(600, 12.5); ctx.fillText(title, x0, y0 - 9);
    ctx.textAlign = 'right'; ctx.font = F(520, 11.5);
    ctx.fillStyle = st.stalled ? BAD : sm < 6 ? BAD : sm < 11 ? WARN : INK2;
    ctx.fillText(st.stalled ? 'STALLED' : st.n > 0.15 ? `surge margin ${sm.toFixed(0)} %  ·  PR ${st.PR.toFixed(2)}  ·  η ${(st.eff * 100).toFixed(0)} %` : 'not turning', x0 + pwi, y0 - 9);
    const mod = { flow: key === 'hpc' ? Math.min(1.3, Math.max(0.4, 1 - 0.012 * (o.vsv - o.vsvSched))) : 1, xs: st.xs - m.xs(st.n) };
    const surge = [];
    for (let n = 0.3; n <= 1.101; n += 0.1) {
      const pts = mapSpeedLine(m, n, mod);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1; ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(X(p.wc), Y(p.pr)) : ctx.moveTo(X(p.wc), Y(p.pr)))); ctx.stroke();
      surge.push(pts[pts.length - 1]);
    }
    ctx.strokeStyle = BAD; ctx.lineWidth = 1.5; ctx.beginPath();
    surge.forEach((p, k) => (k ? ctx.lineTo(X(p.wc), Y(p.pr)) : ctx.moveTo(X(p.wc), Y(p.pr)))); ctx.stroke();
    ctx.fillStyle = BAD; ctx.textAlign = 'right'; ctx.font = F(520, 10.5); ctx.fillText('surge line', X(surge[5].wc) - 8, Y(surge[5].pr) - 4);
    const tr = trails[key]; tr.push([st.wc, st.PR]); if (tr.length > 260) tr.shift();
    ctx.strokeStyle = 'rgba(243,244,246,0.4)'; ctx.lineWidth = 1.2; ctx.beginPath();
    tr.forEach((p, k) => (k ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); ctx.stroke();
    ctx.fillStyle = st.stalled ? BAD : INK; ctx.beginPath(); ctx.arc(X(st.wc), Y(st.PR), 4.5, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(14,15,17,0.9)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = INK3; ctx.textAlign = 'left'; ctx.font = F(500, 10.5); ctx.fillText('corrected airflow →', x0 + 4, y0 + phi + 14);
    ctx.save(); ctx.translate(x0 + 12, y0 + 6); ctx.fillText(`pressure ratio ${prMax}`, 0, 8); ctx.restore();
  });
}

const hist = [];
export function pushTrend(o) { hist.push([o.t, o.N1pct, o.N2pct, o.egt - 273.15, o.epr, o.wf * 3600, o.thrust / 1000]); if (hist.length > 1200) hist.shift(); }
export function drawTrends(cv) {
  const [ctx, w, h] = fit(cv);
  const defs = [['N1', 1, 0, 110, '%', 1], ['N2', 2, 0, 110, '%', 1], ['EGT', 3, 0, 900, '°C', 0], ['EPR', 4, 1, 2.1, '', 3], ['Fuel flow', 5, 0, 7000, 'kg/h', 0], ['Thrust', 6, 0, 160, 'kN', 1]];
  const cols = w > 720 ? 3 : 1, rowsN = Math.ceil(6 / cols), pw = w / cols, ph = h / rowsN;
  defs.forEach(([name, idx, lo, hi, unit, dp], i) => {
    const x0 = (i % cols) * pw + 2, y0 = Math.floor(i / cols) * ph + 22, ww = pw - 4, hh = ph - 30;
    const last = hist.length ? hist[hist.length - 1][idx] : 0;
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = INK2; ctx.font = F(540, 12); ctx.fillText(name, x0, y0 - 7);
    ctx.textAlign = 'right'; ctx.fillStyle = INK; ctx.font = F(600, 12.5); ctx.fillText(`${last.toFixed(dp)} ${unit}`, x0 + ww, y0 - 7);
    ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y0 + hh); ctx.lineTo(x0 + ww, y0 + hh); ctx.stroke();
    if (hist.length < 2) return;
    const pt = (r, k) => [x0 + (k / 1199) * ww, y0 + hh - ((Math.min(Math.max(r[idx], lo), hi) - lo) / (hi - lo)) * hh];
    ctx.beginPath(); hist.forEach((r, k) => { const [x, y] = pt(r, k); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.lineTo(x0 + ((hist.length - 1) / 1199) * ww, y0 + hh); ctx.lineTo(x0, y0 + hh); ctx.closePath();
    const g = ctx.createLinearGradient(0, y0, 0, y0 + hh); g.addColorStop(0, 'rgba(243,244,246,0.14)'); g.addColorStop(1, 'rgba(243,244,246,0)'); ctx.fillStyle = g; ctx.fill();
  });
}
