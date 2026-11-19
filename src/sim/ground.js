// The engine on the apron: the air it draws in and blows out near the ground, and loose objects caught in it.
//
// Frame: the engine's own (metres; x aft along the axis, y up, z to the aircraft's left), as in the 3D view.
// The ground is the plane y = groundY: the nacelle's low point is 0.76 m above it, as on an A320 at normal
// weights (Airbus AC 2-3-0, ground clearances).
//
// Intake: a sink at the inlet that draws its volume flow mostly from ahead (a third from behind the lip, shaded
// by the nacelle), smoothed over the inlet radius, with an image sink below the ground so no air passes through
// it. A ground vortex forms between the ground and the intake when the engine is static; it wanders and pulses,
// and its core lifts small debris. Taking the Airbus intake danger boundary as a contour of induced air speed,
// 1.0 m/s puts it at 2.8 m at idle (AC 6-3: 2.74 m) and about 4.9 m at breakaway power (5.0 m); at take-off the
// same contour reaches about 7.4 m, so the model is more cautious than the published 5.18 m there.
//
// Exhaust: a round turbulent jet from the common nozzle. A potential core of seven nozzle diameters, then the
// centreline speed falls as 1/distance, and the profile is Gaussian with a half-speed radius growing about 0.11 m
// per metre. At take-off this puts 60 m/s at about 39 m behind the nozzle and 30 m/s at about 80 m, against
// 40 m and 78 m on the Airbus exhaust velocity contours (AC 6-1). With the reverser deployed, the bypass air
// leaves forwards and outwards through the cascades instead.
//
// Objects: point masses with drag, weight, ground friction and a fluctuating lift while they tumble. Tall ones
// (traffic cone, suitcase) topple when the wind's moment beats their weight's. Birds fly at their own speed
// and flee strong air; one that cannot out-fly the intake goes in. An object that crosses the inlet is
// ingested, and the damage depends on what it is and how fast the fan hits it (Failures.ingest).

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const G = 9.81;

export const APRON = {
  groundY: -1.87,            // engine axis 1.87 m above the ground (nacelle low point 1.11 m below the axis + 0.76 m)
  inletX: -0.955, inletR: 0.75,
  nozzleX: 4.3, nozzleR: 0.595,
  behind: 0.35,              // share of the intake's draw that comes from behind the lip (static)
  sinkIn: 0.35,              // the sink's centre, behind the highlight plane (m)
  vortexK: 0.4,              // ground vortex circulation / (inlet speed x diameter)
  vortexCore: 0.15,          // m
  vortexLift: 0.08,          // broad updraft round the vortex foot / inlet speed
  jetCore: 7,                // potential core length, nozzle diameters
  jetSpread: 0.11,           // growth of the half-speed radius, m per m
  dangerSpeed: 1.0,          // m/s: induced speed on the intake danger boundary (see above)
};

/**
 * Loose objects. m kg; cda drag area m^2 (tumbling average); size m (for drawing and resting height); mu ground
 * friction; lift: amplitude of the tumbling lift as a fraction of drag; hit: soft (bird, cloth), semi (plastic) or
 * hard (metal, stone). Upright objects carry h (height of the wind's push) and base (half-width of the footing).
 * Birds have their own flying speed.
 */
export const OBJECTS = {
  pigeon: { name: 'Pigeon', m: 0.35, cda: 0.012, size: 0.3, mu: 0.6, lift: 0.3, hit: 'soft', fly: 12 },
  gull: { name: 'Gull', m: 0.9, cda: 0.025, size: 0.45, mu: 0.6, lift: 0.3, hit: 'soft', fly: 11 },
  goose: { name: 'Canada goose', m: 3.6, cda: 0.06, size: 0.75, mu: 0.6, lift: 0.3, hit: 'soft', fly: 15 },
  cone: { name: 'Traffic cone', m: 3.0, cda: 0.11, cdaDown: 0.16, size: 0.75, mu: 0.7, roll: 0.08, lift: 0.35, hit: 'semi', h: 0.3, base: 0.19 },
  rag: { name: 'Shop rag', m: 0.06, cda: 0.08, size: 0.35, mu: 0.8, lift: 0.8, hit: 'soft' },
  bag: { name: 'Plastic bag', m: 0.012, cda: 0.1, size: 0.4, mu: 0.6, lift: 1.0, hit: 'soft' },
  bolt: { name: 'Bolt', m: 0.035, cda: 0.00045, size: 0.06, mu: 0.35, lift: 0.1, hit: 'hard' },
  stone: { name: 'Stone', m: 0.05, cda: 0.0008, size: 0.04, mu: 0.5, lift: 0.1, hit: 'hard' },
  case: { name: 'Suitcase', m: 18, cda: 0.35, cdaDown: 0.3, size: 0.7, mu: 0.5, roll: 0.35, lift: 0.3, hit: 'semi', h: 0.36, base: 0.12 },
};

export class Apron {
  constructor() {
    this.objs = []; this.events = []; this.t = 0; this._seed = 12345; this._id = 1;
    this.f = { rho: 1.225, Q: 0, Vin: 0, Vj: 0, Vbyp: 0, rev: 0, w1: 0, w2: 0 };
    this.vtx = { x: APRON.inletX - 0.5, z: 0, k: 0, gx: 0, gz: 0, gk: 1 };
  }
  _rand() { this._seed = (this._seed * 16807) % 2147483647; return (this._seed - 1) / 2147483646; }
  /** One step of a mean-reverting random process: mean m, standard deviation sd, reversion rate th (1/s). */
  _ou(x, m, sd, th, dt) { return x + (m - x) * th * dt + sd * Math.sqrt(2 * th * dt) * (this._rand() - 0.5) * 3.4641; }

  /** Take the flow from the engine's output. */
  setFlow(o) {
    const rho = (o.P0 || 101325) / (287.05 * (o.T0 || 288.15));
    const Q = Math.max(0, (o.W2 || 0) / rho), rev = clamp(o.rev || 0, 0, 1);
    Object.assign(this.f, {
      rho, Q, Vin: Q / (Math.PI * APRON.inletR ** 2),
      Vj: Math.max(0, rev > 0.5 ? (o.V8 || 0) * Math.sqrt(Math.max(0, (o.W8 || 0) / Math.max(1, o.W9 || 1))) : o.V9 || 0),   // reversed: only the core stream goes aft
      Vbyp: rev * (o.V18 || 0), rev,
      w1: ((o.N1pct || 0) / 100) * 5650 * Math.PI / 30, w2: ((o.N2pct || 0) / 100) * 14950 * Math.PI / 30,
    });
  }

  /** Air velocity at (x, y, z), into out = [ux, uy, uz]. */
  air(x, y, z, out = [0, 0, 0]) {
    const f = this.f, A = APRON, a = A.inletR, cx = A.inletX, gy = A.groundY;
    let ux = 0, uy = 0, uz = 0;
    if (f.Q > 0) {
      // intake sink and its image below the ground. A static intake draws from all round, but the nacelle
      // shades what comes from behind the lip; the weights are normalised so the sink still swallows Q.
      const shade = (A.behind + (1 - A.behind) * smooth(1 - (x - cx) / (1.5 * a))) / (1 + A.behind), e2 = 0.5 * a * a;
      // Ahead of the lip the sink sits inside the intake, so the lip plane sees the full inflow; air from behind the
      // lip is drawn towards a point just ahead of it, so it runs forward along the cowl and round the lip.
      const rr = Math.hypot(y, z), bk = smooth((x - cx) / 0.05) * smooth((rr - 0.9 * a) / (0.1 * a));
      const sx = (cx + A.sinkIn) * (1 - bk) + Math.min(cx + A.sinkIn, x - 0.35) * bk;
      for (const sy of [0, 2 * gy]) {
        const dx = x - sx, dy = y - sy, dz = z, d2 = dx * dx + dy * dy + dz * dz;
        const k = (-f.Q / (2 * Math.PI)) * shade / Math.pow(d2 + e2, 1.5);
        ux += k * dx; uy += k * dy; uz += k * dz;
      }
      // ground vortex: a wandering, pulsing column from the ground up into the intake
      const v = this.vtx, gam = A.vortexK * f.Vin * 2 * a * v.k;
      if (gam > 0.01 && y < -a + 0.35) {
        const rx = x - v.x, rz = z - v.z, r2 = rx * rx + rz * rz, rc2 = A.vortexCore ** 2, r = Math.sqrt(r2) + 1e-6;
        const fade = smooth((-a + 0.35 - y) / 0.4);
        const vt = (gam / (2 * Math.PI * r)) * (1 - Math.exp(-r2 / rc2)) * Math.exp(-r2 / 0.64) * fade;   // swirl confined to the column
        // near the ground friction slows the swirl and the inflow takes over, sweeping debris into the core
        // (the tea-leaf effect), where the updraft lifts it
        const near = Math.exp(-(y - gy) / 0.3);
        ux += (-rz / r) * vt * (1 - 0.85 * near); uz += (rx / r) * vt * (1 - 0.85 * near);
        uy += 0.6 * (gam / (2 * Math.PI * A.vortexCore)) * Math.exp(-r2 / (1.8 * rc2)) * fade;        // updraft in the core
        ux -= (rx / r) * 0.45 * vt * near; uz -= (rz / r) * 0.45 * vt * near;
      }
      // and a broader, gentler updraft round the vortex foot, between the ground and the lip: it lifts light
      // debris that has gathered under the intake (rags and bags, not bolts)
      if (y < -a + 0.2) {
        const rx = x - v.x, rz = z - v.z;
        uy += A.vortexLift * f.Vin * Math.exp(-(rx * rx + rz * rz) / 0.64) * smooth((-a + 0.2 - y) / 0.4) * smooth((y - gy) / 0.12);
      }
    }
    if (f.Vj > 0.5) {
      // exhaust jet, sinking towards the ground as it spreads
      const D = 2 * A.nozzleR, s = x - A.nozzleX;
      if (s > -0.3) {
        const sp = Math.max(0, s), Lc = A.jetCore * D, Uc = sp < Lc ? f.Vj : (f.Vj * Lc) / sp;
        const b = 0.45 * D + A.jetSpread * sp, h0 = -gy;
        const yc = gy + Math.max(0.35 * b, h0 - Math.max(0, sp - h0 / A.jetSpread) * 0.06);
        const dy = y - Math.min(0, yc), r2 = dy * dy + z * z;
        const u = Uc * Math.exp((-Math.LN2 * r2) / (b * b)) * smooth((s + 0.3) / 0.6);
        ux += u; uz += u * 0.05 * (z / b); uy += y > gy + 0.05 ? u * 0.02 * (dy / b) : 0;
      }
    }
    if (f.Vbyp > 1) {
      // reverser efflux: forwards and outwards from the cascades, mostly to the sides and below
      const dx = x - 2.0, r = Math.hypot(y, z) + 1e-6, rr = r - 1.0;
      const d = Math.hypot(dx, rr), along = (-dx + rr) / Math.SQRT2;                               // along the 45 deg forward-outward line
      if (along > 0) {
        const off = Math.abs((dx + rr) / Math.SQRT2), b = 0.4 + 0.15 * along;
        const u = f.Vbyp * Math.min(1, 1.2 / (0.6 + 0.12 * along)) * Math.exp((-Math.LN2 * off * off) / (b * b)) * (d > 0.2 ? 1 : 0);
        ux -= u / Math.SQRT2; uy += (u / Math.SQRT2) * (y / r); uz += (u / Math.SQRT2) * (z / r);
      }
    }
    out[0] = ux; out[1] = uy; out[2] = uz;
    return out;
  }

  /** Air speed at a point (m/s). */
  speed(x, y, z) { const u = this.air(x, y, z); return Math.hypot(u[0], u[1], u[2]); }
  /** Radius ahead of the inlet, at its height, where the induced speed falls to u (default: the danger speed). */
  dangerRadius(u = APRON.dangerSpeed) {
    let lo = 0.8, hi = 30;
    if (this.speed(APRON.inletX - hi, 0, 0) > u) return hi;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (this.speed(APRON.inletX - m, 0, 0) > u) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  /** Distance behind the nozzle, at the ground, where the jet slows to u. */
  jetReach(u, y = APRON.groundY + 0.3) {
    let last = 0;
    for (let s = 1; s < 600; s *= 1.04) { if (this.speed(APRON.nozzleX + s, y, 0) >= u) last = s; else if (s > 15) break; }
    return last;
  }

  /** Put an object down at (x, z); birds take off from there at height h, flying across the engine. */
  add(kind, x, z, opt = {}) {
    const d = OBJECTS[kind]; if (!d) return null;
    const bird = !!d.fly, gy = APRON.groundY;
    const y = bird ? gy + (opt.h ?? 1.5) : gy + (d.h ? 0 : d.size * 0.15);
    const hd = opt.heading ?? (z > 0 ? -1 : 1) * Math.PI / 2 + (this._rand() - 0.5) * 0.6;   // birds: towards the engine's centreline, across it
    const o = {
      id: this._id++, kind, d, x, y, z, vx: 0, vy: 0, vz: 0, ground: !bird, upright: !!d.h, tip: 0, tipDir: 0, state: bird ? 'flying' : 'rest',
      q: [0, 0, 0, 1], w: [0, 0, 0], cl: 0, gust: [0, 0, 0], hd, flap: this._rand() * 6, panic: 0, age: 0,
    };
    if (!bird) { const a = this._rand() * Math.PI * 2; o.q = [0, Math.sin(a / 2), 0, Math.cos(a / 2)]; }
    this.objs.push(o);
    return o;
  }
  clear() { this.objs.length = 0; }

  /** Advance the objects by dt; engine: the Engine, whose failure model takes the ingestion damage. */
  step(dt, engine) {
    if (dt <= 0) return;
    this.t += dt;
    const f = this.f, A = APRON, gy = A.groundY;
    // the ground vortex wanders about a point ahead of the lip and comes and goes
    const v = this.vtx, on = smooth((f.Vin - 25) / 40);
    v.gx = this._ou(v.gx, 0, 0.35, 0.8, dt); v.gz = this._ou(v.gz, 0, 0.3, 0.8, dt);
    v.gk = clamp(this._ou(v.gk, 0.8, 0.3, 0.7, dt), 0.2, 1.3);
    v.x = A.inletX + 0.2 + clamp(v.gx, -0.5, 0.5); v.z = clamp(v.gz, -0.4, 0.4); v.k = on * v.gk;   // foot near the ground stagnation point, under the lip
    const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n, u = [0, 0, 0];
    for (const o of this.objs) {
      if (o.state === 'ingested' || o.state === 'gone') continue;
      o.age += dt;
      for (let i = 0; i < n && o.state !== 'ingested'; i++) this._move(o, h, u, engine);
      this._spin(o, dt);
      const far = o.d.fly ? 30 : 140;
      if (o.state !== 'ingested' && (Math.abs(o.x) > far || Math.abs(o.z) > far * 0.7 || o.y > gy + 40)) o.state = 'gone';
    }
    // forget objects that are long gone
    if (this.objs.length > 60) this.objs = this.objs.filter((o) => o.state !== 'gone' && o.state !== 'ingested');
  }

  _move(o, h, u, engine) {
    const d = o.d, f = this.f, A = APRON, gy = A.groundY;
    this.air(o.x, o.y, o.z, u);
    if (d.size > 0.25) {   // a big object feels the air averaged over its size, not a narrow vortex core at its centre
      const hs = d.size * 0.4, w = this._w || (this._w = [0, 0, 0]);
      for (const [ox, oz] of [[hs, 0], [-hs, 0], [0, hs], [0, -hs]]) { this.air(o.x + ox, o.y, o.z + oz, w); u[0] += w[0]; u[1] += w[1]; u[2] += w[2]; }
      u[0] /= 5; u[1] /= 5; u[2] /= 5;
    }
    // turbulence: a smoothed random gust proportional to the local speed
    const sp = Math.hypot(u[0], u[1], u[2]), I = 0.14 * sp, g = o.gust, tau = 0.25;
    for (let k = 0; k < 3; k++) g[k] = this._ou(g[k], 0, I, 1 / tau, h);
    u[0] += g[0]; u[1] += g[1] * 0.6; u[2] += g[2];
    if (d.fly && o.state === 'flying') {
      // a bird flies at its own speed through the moving air; when the air gets strong it turns away from it
      if (sp > 0.35 * d.fly) o.panic = Math.min(1, o.panic + h * 3);
      let tx = Math.cos(o.hd), tz = Math.sin(o.hd), ty = 0;
      if (o.panic > 0) { const m = sp + 1e-6; tx = -u[0] / m; ty = -u[1] / m * 0.5; tz = -u[2] / m; const l = Math.hypot(tx, ty, tz) + 1e-6; tx /= l; ty /= l; tz /= l; }
      ty += clamp((gy + 1.5 - o.y) * 0.5, -0.5, 0.5);
      const vf = d.fly * (0.8 + 0.4 * o.panic);
      o.vx = u[0] + tx * vf; o.vy = u[1] * 0.7 + ty * vf; o.vz = u[2] + tz * vf;
      o.flap += h * (8 + 6 * o.panic);
    } else {
      const rvx = u[0] - o.vx, rvy = u[1] - o.vy, rvz = u[2] - o.vz, rv = Math.hypot(rvx, rvy, rvz);
      const cda = o.upright ? d.cda : d.cdaDown || d.cda, q = 0.5 * f.rho * cda * rv, kd = q / d.m;   // drag force per unit relative speed; rate 1/s
      const fx = q * rvx, fz = q * rvz;
      // tumbling lift, fluctuating; it is what makes things hop and fly in a strong wind
      o.cl = clamp(this._ou(o.cl, 0.15 * d.lift, 0.7 * d.lift, 1 / 0.18, h), -1.5 * d.lift, 1.5 * d.lift);
      const rvh2 = rvx * rvx + rvz * rvz, lift = o.upright ? 0 : 0.5 * f.rho * cda * rvh2 * o.cl;   // from the wind across it, not its own rise or fall
      let ax = 0, ay = lift / d.m - G, az = 0, still = false, vert = true;
      if (o.ground) {
        const N = d.m * G - lift - q * rvy;
        if (o.upright) {
          // a tall object topples when the wind's moment about the leeward edge beats its weight's
          if (Math.hypot(fx, fz) * d.h > d.m * G * d.base) { o.upright = false; o.tip = 0.01; o.tipDir = Math.atan2(fz, fx); }
        }
        if (N <= 0) { o.ground = false; o.state = 'flying'; }
        else {
          const vh = Math.hypot(o.vx, o.vz), fh = Math.hypot(fx, fz), mu = !o.upright && d.roll ? d.roll : d.mu;
          if (vh < 0.02 && fh <= mu * N) { o.vx = 0; o.vz = 0; still = true; o.state = 'rest'; }
          else {
            const fr = mu * 0.85 * N / d.m;
            if (vh > 0.02) { ax = (-fr * o.vx) / vh; az = (-fr * o.vz) / vh; } else { const c = Math.min(fr, fh / d.m); ax = (-c * fx) / (fh + 1e-9); az = (-c * fz) / (fh + 1e-9); }
            o.state = 'slide';
          }
          o.vy = 0; ay = 0; vert = false;
        }
      }
      // drag integrated implicitly (stable however light the object); the rest explicitly
      if (!still) {
        const den = 1 + h * kd;
        o.vx = (o.vx + h * ax + h * kd * u[0]) / den; o.vz = (o.vz + h * az + h * kd * u[2]) / den;
        if (o.ground && Math.hypot(o.vx, o.vz) < 0.02 && ax * fx + az * fz < 0) { /* friction stopped it */ }
      }
      if (vert) o.vy = (o.vy + h * ay + h * kd * u[1]) / (1 + h * kd);
    }
    o.x += o.vx * h; o.y += o.vy * h; o.z += o.vz * h;
    // the ground
    const rest = gy + (o.upright ? 0 : d.size * 0.15);
    if (o.y <= rest) {
      o.y = rest;
      if (o.vy < -2 && !d.fly) { o.vy = -o.vy * 0.25; o.vx *= 0.7; o.vz *= 0.7; o.ground = false; }   // bounce
      else { o.vy = 0; o.ground = true; if (d.fly) { o.state = 'rest'; o.ground = true; } }
    }
    // the inlet: anything that crosses the highlight inside the lip is ingested
    const r = Math.hypot(o.y, o.z), xi = A.inletX;
    if (o.x > xi - 0.03 && o.x < xi + 0.8 && r < A.inletR + 0.04) { this._ingest(o, Math.min(r, A.inletR - 0.02), engine); return; }   // on the lip itself the air takes it in
    // the nacelle outside (rounded lip, deeper underneath): slide along it, never into it
    const rn = nacelleR(o.x, o.y, r);
    if (o.x > xi && o.x < A.nozzleX && r < rn && r >= A.inletR - 0.02) {
      const k = rn / (r + 1e-6); o.y *= k; o.z *= k;
      const ny = o.y / rn, nz = o.z / rn, vr = o.vy * ny + o.vz * nz;
      if (vr < 0) { o.vy -= vr * ny; o.vz -= vr * nz; }
    }
  }

  _spin(o, dt) {
    const d = o.d;
    if (d.fly && o.state === 'flying') {   // birds face where they are going
      const hd = Math.atan2(o.vz, o.vx); o.q = [0, Math.sin(-hd / 2), 0, Math.cos(-hd / 2)];
      return;
    }
    if (o.upright) return;
    if (o.tip > 0 && o.tip < 1) o.tip = Math.min(1, o.tip + dt * 3.5);   // the topple itself, drawn by the view
    const v = Math.hypot(o.vx, o.vy, o.vz), w = o.w;
    if (o.ground && o.state === 'rest') { for (let k = 0; k < 3; k++) w[k] *= Math.max(0, 1 - dt * 6); }
    else {
      const k = (o.ground ? 2 : 6) * Math.min(v, 40) / Math.max(0.05, d.size);
      for (let i = 0; i < 3; i++) w[i] += ((this._rand() - 0.5) * k - w[i] * 1.5) * dt;
      if (o.ground) { const s = Math.hypot(o.vx, o.vz) / Math.max(0.05, d.size * 0.5); w[0] = o.vz / (Math.hypot(o.vx, o.vz) + 1e-6) * s; w[2] = -o.vx / (Math.hypot(o.vx, o.vz) + 1e-6) * s; w[1] *= 0.9; }
    }
    // integrate the orientation quaternion
    const [x, y, z, ww] = o.q, hx = 0.5 * dt * w[0], hy = 0.5 * dt * w[1], hz = 0.5 * dt * w[2];
    const q = [x + hx * ww + hy * z - hz * y, y - hx * z + hy * ww + hz * x, z + hx * y - hy * x + hz * ww, ww - hx * x - hy * y - hz * z];
    const l = Math.hypot(...q); o.q = q.map((c) => c / l);
  }

  _ingest(o, r, engine) {
    o.state = 'ingested';
    const f = this.f, U = f.w1 * clamp(r, 0.25, A_TIP), Vax = f.Vin * 1.1;
    const res = engine && engine.fail ? engine.fail.ingest(o.kind, o.d, r, { U, Vax, w2: f.w2, rand: () => this._rand() }) : null;
    this.events.push({ t: this.t, type: 'ingest', obj: o, res });
  }
}
const A_TIP = 0.8;
/** Outer radius of the nacelle at x for a point at height y and radius r: the lip rounds from the highlight to the
 * full cowl over its first 0.3 m, and the cowl is deeper underneath (the A320 nacelle is egg-shaped). */
function nacelleR(x, y, r) {
  const s = smooth((x - APRON.inletX) / 0.3);
  return (APRON.inletR + 0.27 * s) * (1 + 0.08 * clamp(-y / (r + 1e-6), 0, 1));
}
