// ECAM-style engine display and small plots, drawn on canvas.
import { mapSpeedLine } from '../src/sim/components.js';

const G = '#2fe36a', A = '#ffa41c', R = '#ff3b30', W = '#e9eef2', DIM = '#6f7f8c', C = '#35d6ff';
const FONT = "'B612 Mono', Consolas, monospace";

function fit(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), r = cv.getBoundingClientRect();
  if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
  return [ctx, r.width, r.height];
}

function dial(ctx, cx, cy, rad, o) {
  const a0 = Math.PI * 0.85, a1 = Math.PI * 2.15;
  const ang = (v) => a0 + ((Math.min(Math.max(v, o.min), o.max) - o.min) / (o.max - o.min)) * (a1 - a0);
  ctx.lineWidth = 3; ctx.lineCap = 'butt';
  const arc = (v0, v1, col) => { ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(cx, cy, rad, ang(v0), ang(v1)); ctx.stroke(); };
  arc(o.min, o.amber ?? o.red ?? o.max, W);
  if (o.amber != null) arc(o.amber, o.red ?? o.max, A);
  if (o.red != null) arc(o.red, o.max, R);
  ctx.fillStyle = DIM; ctx.font = `10px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const t of o.ticks || []) { const a = ang(t); ctx.fillText(o.tickFmt ? o.tickFmt(t) : t, cx + Math.cos(a) * (rad + 13), cy + Math.sin(a) * (rad + 11)); }
  if (o.bug != null) { const a = ang(o.bug); ctx.strokeStyle = C; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (rad + 5), cy + Math.sin(a) * (rad + 5), 3, 0, 7); ctx.stroke(); }
  const col = o.red != null && o.value >= o.red ? R : o.amber != null && o.value >= o.amber ? A : G;
  const a = ang(o.value);
  ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rad * 0.62, cy + Math.sin(a) * rad * 0.62); ctx.lineTo(cx + Math.cos(a) * (rad + 3), cy + Math.sin(a) * (rad + 3)); ctx.stroke();
  ctx.fillStyle = col; ctx.font = `600 ${Math.round(rad * 0.36)}px ${FONT}`; ctx.fillText(o.fmt(o.value), cx, cy + 2);
  ctx.fillStyle = C; ctx.font = `600 11px ${FONT}`; ctx.fillText(o.label, cx, cy + rad * 0.5);
}

export function drawEcam(cv, o, f, peaks, egtRed = 635) {
  const [ctx, w, h] = fit(cv);
  const rad = Math.min(w / 4 / 2 - 22, h * 0.24);
  const cy = rad + 26, step = w / 4;
  const egt = o.egt - 273.15;
  dial(ctx, step * 0.5, cy, rad, { min: 1, max: 2.2, value: o.epr, bug: f.eprCmd, label: 'EPR', fmt: (v) => v.toFixed(3), ticks: [1, 1.4, 1.8, 2.2], tickFmt: (t) => t.toFixed(1) });
  dial(ctx, step * 1.5, cy, rad, { min: 0, max: 900, value: egt, amber: 610, red: egtRed, label: 'EGT °C', fmt: (v) => v.toFixed(0), ticks: [0, 300, 600, 900] });
  dial(ctx, step * 2.5, cy, rad, { min: 0, max: 115, value: o.N1pct, red: 100, label: 'N1 %', fmt: (v) => v.toFixed(1), ticks: [0, 50, 100] });
  dial(ctx, step * 3.5, cy, rad, { min: 0, max: 115, value: o.N2pct, red: 100, label: 'N2 %', fmt: (v) => v.toFixed(1), ticks: [0, 50, 100] });
  // digital row
  const y = cy + rad + 30;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const cell = (x, label, val, unit, col = G) => {
    ctx.fillStyle = C; ctx.font = `600 11px ${FONT}`; ctx.fillText(label, x, y);
    ctx.fillStyle = col; ctx.font = `600 19px ${FONT}`; ctx.fillText(val, x, y + 22);
    ctx.fillStyle = DIM; ctx.font = `11px ${FONT}`; ctx.fillText(unit, x + ctx.measureText(val).width * 1.75 + 4, y + 22);
  };
  const cw = w / 5;
  cell(10, 'THRUST', (o.thrust / 1000).toFixed(1), 'kN');
  cell(10 + cw, '', (o.thrust / 4.4482216).toFixed(0), 'lbf');
  cell(10 + cw * 2, 'FUEL FLOW', (o.wf * 3600).toFixed(0), 'kg/h');
  cell(10 + cw * 3, 'FUEL USED', o.fuelUsed.toFixed(1), 'kg');
  cell(10 + cw * 4, 'TSFC', o.sfc > 0 ? o.sfc.toFixed(3) : '---', '/h');
  // status line
  const y2 = y + 48;
  ctx.font = `600 12px ${FONT}`;
  let x = 10;
  const tag = (txt, col) => { ctx.fillStyle = col; ctx.fillText(txt, x, y2); x += ctx.measureText(txt).width + 16; };
  tag(o.lit ? 'FLAME' : 'NO FLAME', o.lit ? G : DIM);
  if (o.ignOn) tag('IGN A+B', G);
  if (o.tStart > 0) tag('START VALVE', G);
  if (f.limiter && f.master) tag('CTRL: ' + f.limiter.toUpperCase(), C);
  if (f.msg) tag(f.msg, f.msg.includes('ABORT') || f.msg.includes('STALL') || f.msg.includes('FLAME') ? A : G);
  if (o.hpc.stalled || o.lpc.stalled || o.fan.stalled) tag('COMPRESSOR STALL', R);
  if (egt > egtRed) tag('EGT OVERLIMIT', R);
  if (o.N1pct > 100 || o.N2pct > 100) tag('OVERSPEED', R);
  ctx.fillStyle = DIM; ctx.font = `11px ${FONT}`;
  ctx.fillText(`PEAK  EGT ${peaks.egt.toFixed(0)}°C   N1 ${peaks.n1.toFixed(1)}   N2 ${peaks.n2.toFixed(1)}`, 10, y2 + 18);
}

const trails = { fan: [], lpc: [], hpc: [] };
export function drawMaps(cv, eng) {
  const [ctx, w, h] = fit(cv);
  const o = eng.out, cfg = eng.cfg;
  const defs = [['FAN (bypass)', 'fan', 360, 2.3], ['LPC (booster)', 'lpc', 85, 3.2], ['HPC', 'hpc', 85, 18]];
  const pw = w / 3;
  defs.forEach(([title, key, wMax, prMax], i) => {
    const m = cfg[key], x0 = i * pw + 34, y0 = 20, pwi = pw - 46, phi = h - 46;
    const X = (wc) => x0 + (wc / wMax) * pwi, Y = (pr) => y0 + phi - ((pr - 1) / (prMax - 1)) * phi;
    ctx.strokeStyle = '#2a333b'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, pwi, phi);
    ctx.fillStyle = W; ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText(title, x0 + 4, y0 + 13);
    ctx.fillStyle = DIM; ctx.font = `10px ${FONT}`;
    ctx.fillText('PR', x0 - 30, y0 + 10); ctx.fillText(prMax, x0 - 30, y0 + 24); ctx.fillText('1', x0 - 14, y0 + phi);
    ctx.fillText(`corrected flow → ${wMax} kg/s`, x0 + 2, y0 + phi + 14);
    const mod = { flow: key === 'hpc' ? Math.min(1.3, Math.max(0.4, 1 - 0.012 * (o.vsv - o.vsvSched))) : 1, xs: o[key].xs - m.xs(o[key].n) };
    const surge = [];
    for (let n = 0.3; n <= 1.101; n += 0.1) {
      const pts = mapSpeedLine(m, n, mod);
      ctx.strokeStyle = '#3b4c63'; ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(X(p.wc), Y(p.pr)) : ctx.moveTo(X(p.wc), Y(p.pr)))); ctx.stroke();
      surge.push(pts[pts.length - 1]);
    }
    ctx.strokeStyle = R; ctx.lineWidth = 1.5; ctx.beginPath();
    surge.forEach((p, k) => (k ? ctx.lineTo(X(p.wc), Y(p.pr)) : ctx.moveTo(X(p.wc), Y(p.pr)))); ctx.stroke();
    ctx.fillStyle = R; ctx.fillText('surge line', X(surge[5].wc) - 62, Y(surge[5].pr) - 4);
    const tr = trails[key];
    tr.push([o[key].wc, o[key].PR]); if (tr.length > 240) tr.shift();
    ctx.strokeStyle = 'rgba(76,201,240,0.5)'; ctx.lineWidth = 1; ctx.beginPath();
    tr.forEach((p, k) => (k ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); ctx.stroke();
    ctx.fillStyle = o[key].stalled ? R : G; ctx.beginPath(); ctx.arc(X(o[key].wc), Y(o[key].PR), 4, 0, 7); ctx.fill();
    const sm = o[key].xs > 0 ? (100 * (o[key].xs - o[key].x)) / o[key].xs : 0;
    ctx.fillStyle = sm < 5 ? R : sm < 10 ? A : G; ctx.textAlign = 'right';
    ctx.fillText(`margin ${o[key].n > 0.15 ? sm.toFixed(0) + '%' : '--'}  η ${(o[key].eff * 100).toFixed(0)}%`, x0 + pwi - 4, y0 + 13);
  });
}

const hist = [];
export function pushTrend(o) { hist.push([o.t, o.N1pct, o.N2pct, o.egt - 273.15, o.epr, o.wf * 3600, o.thrust / 1000]); if (hist.length > 1200) hist.shift(); }
export function drawTrends(cv) {
  const [ctx, w, h] = fit(cv);
  const defs = [['N1 %', 1, 0, 110, C], ['N2 %', 2, 0, 110, A], ['EGT °C', 3, 0, 900, R], ['EPR', 4, 1, 2.2, G], ['FF kg/h', 5, 0, 7000, '#c792ea'], ['THRUST kN', 6, 0, 160, W]];
  const rows = 2, cols = 3, pw = w / cols, ph = h / rows;
  defs.forEach(([name, idx, lo, hi, col], i) => {
    const x0 = (i % cols) * pw + 6, y0 = Math.floor(i / cols) * ph + 4, ww = pw - 12, hh = ph - 10;
    ctx.strokeStyle = '#243041'; ctx.strokeRect(x0, y0, ww, hh);
    ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.beginPath();
    hist.forEach((r, k) => { const x = x0 + (k / 1199) * ww, y = y0 + hh - ((Math.min(Math.max(r[idx], lo), hi) - lo) / (hi - lo)) * hh; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.fillStyle = col; ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'left';
    const last = hist.length ? hist[hist.length - 1][idx] : 0;
    ctx.fillText(`${name}  ${last.toFixed(idx === 4 ? 3 : 1)}`, x0 + 5, y0 + 14);
  });
}
