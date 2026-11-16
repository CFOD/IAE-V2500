// Inspects a Microsoft Flight Simulator sound package (Wwise .pck) and writes a text report.
// Nothing is uploaded or modified. Usage:  node tools/msfs-sound-inspect.mjs <path to .pck>
// The report lists the package contents, the audio codec of each clip and how clips link to the
// engine sound events, so a converter can be written for this pack.
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.log('Drag the .pck file onto "Inspect sound pack.bat", or run: node tools/msfs-sound-inspect.mjs <file.pck>'); process.exit(1); }
const buf = fs.readFileSync(file);
const out = []; const say = (...a) => out.push(a.join(' '));
const hex = (b, o, n) => [...b.subarray(o, Math.min(b.length, o + n))].map((x) => x.toString(16).padStart(2, '0')).join(' ');
const fourcc = (b, o) => b.toString('latin1', o, o + 4);
/** Wwise ID hash: 32-bit FNV-1 of the lower-cased name. */
const fnv = (s) => { let h = 2166136261; for (const c of Buffer.from(s.toLowerCase(), 'latin1')) h = (Math.imul(h, 16777619) ^ c) >>> 0; return h >>> 0; };
const safe = (label, fn) => { try { fn(); } catch (e) { say(`!! ${label} failed: ${e.message}`); } };

const EVENTS = ['IAEEngine_StarterLX', 'IAEEngine_CombLX', 'IAEEngine_IntakeLX', 'IAEEngine_ExhaustLX', 'IAEEngine_ShutLX', 'IAEEngine_StarterL', 'IAEEngine_CombL', 'IAEEngine_IntakeL', 'IAEEngine_ShutL', 'APUX', 'WindX'];
const RTPCS = ['SIMVAR_TURB_ENG_N1', 'SIMVAR_TURB_ENG_N2', 'SIMVAR_GENERAL_ENG_COMBUSTION', 'SIMVAR_CAMERA_STATE', 'SIMVAR_AIRSPEED_TRUE', 'SIMVAR_TURB_ENG_REVERSE_NOZZLE_PERCENT', 'SIMVAR_TURB_ENG_ITT'];

say(`file: ${path.basename(file)}  size: ${buf.length} bytes`);
say(`first bytes: ${hex(buf, 0, 48)}`);

// ---------------------------------------------------------------- package (AKPK) directory
const entries = []; // {kind, id, offset, size}
safe('AKPK header', () => {
  if (fourcc(buf, 0) !== 'AKPK') { say('not an AKPK package; magic = ' + fourcc(buf, 0)); return; }
  const headerSize = buf.readUInt32LE(4), version = buf.readUInt32LE(8);
  const sizes = [12, 16, 20, 24].map((o) => buf.readUInt32LE(o));
  say(`AKPK headerSize=${headerSize} version=${version} sectionSizes(lang,banks,streams,external)=${sizes.join(',')}`);
  let p = 28;
  say(`language map (${sizes[0]} bytes): ${hex(buf, p, Math.min(sizes[0], 48))}`);
  p += sizes[0];
  for (const [kind, size, wide] of [['bank', sizes[1], false], ['stream', sizes[2], false], ['external', sizes[3], true]]) {
    if (!size) { say(`${kind}: none`); continue; }
    const count = buf.readUInt32LE(p), rec = wide ? 24 : 20;
    say(`${kind}: ${count} entries (table ${size} bytes, expected ${4 + count * rec})`);
    for (let i = 0; i < count; i++) {
      const o = p + 4 + i * rec, id = wide ? Number(buf.readBigUInt64LE(o)) : buf.readUInt32LE(o), q = o + (wide ? 8 : 4);
      const block = buf.readUInt32LE(q), fsize = buf.readUInt32LE(q + 4), start = buf.readUInt32LE(q + 8), lang = buf.readUInt32LE(q + 12);
      const offset = start * (block || 1);
      entries.push({ kind, id, offset, size: fsize, lang });
      if (i < 6) say(`   ${kind}[${i}] id=${id} block=${block} size=${fsize} start=${start} -> offset ${offset} lang=${lang} magic=${offset + 4 <= buf.length ? fourcc(buf, offset) : '??'}`);
    }
    p += size;
  }
});

// ---------------------------------------------------------------- audio clips (RIFF / WEM)
const CODEC = { 0x0001: 'PCM', 0x0002: 'Wwise ADPCM', 0xfffe: 'PCM (extensible)', 0xffff: 'Wwise Vorbis', 0x3039: 'Opus (NX)', 0x3040: 'Opus', 0x3041: 'Opus (WEM)', 0x0166: 'XMA2', 0xaac0: 'AAC' };
function riffInfo(b, off, size) {
  const magic = fourcc(b, off); if (magic !== 'RIFF' && magic !== 'RIFX') return null;
  const be = magic === 'RIFX', u16 = (o) => (be ? b.readUInt16BE(o) : b.readUInt16LE(o)), u32 = (o) => (be ? b.readUInt32BE(o) : b.readUInt32LE(o));
  const info = { size }; let p = off + 12; const end = Math.min(b.length, off + size);
  while (p + 8 <= end) {
    const id = fourcc(b, p), len = u32(p + 4);
    if (id === 'fmt ') { info.tag = u16(p + 8); info.ch = u16(p + 10); info.rate = u32(p + 12); info.avg = u32(p + 16); info.fmtLen = len; if (len >= 0x1c && info.tag === 0xffff) info.samples = u32(p + 8 + 0x18); }
    if (id === 'data') { info.dataLen = len; break; }
    if (id === 'smpl' || id === 'cue ' || id === 'LIST') info.hasLoopChunk = true;
    p += 8 + len + (len & 1);
  }
  info.codec = CODEC[info.tag] || `0x${(info.tag ?? 0).toString(16)}`;
  info.seconds = info.samples && info.rate ? info.samples / info.rate : info.avg ? (info.dataLen || size) / info.avg : 0;
  return info;
}
const clips = new Map(); // wem id -> info
safe('streams', () => { for (const e of entries) if (e.kind !== 'bank') { const i = riffInfo(buf, e.offset, e.size); if (i) clips.set(e.id, { ...i, where: 'package' }); } });

// ---------------------------------------------------------------- soundbanks
const objects = new Map(); // id -> {type, data(Buffer), bank}
const typeCount = {};
safe('soundbanks', () => {
  for (const e of entries.filter((x) => x.kind === 'bank')) {
    let p = e.offset; const end = e.offset + e.size; const chunks = []; let didx = [], dataOff = 0, bankVer = 0;
    while (p + 8 <= end) {
      const id = fourcc(buf, p), len = buf.readUInt32LE(p + 4), body = p + 8; chunks.push(`${id}:${len}`);
      if (id === 'BKHD') bankVer = buf.readUInt32LE(body);
      if (id === 'DIDX') for (let o = body; o + 12 <= body + len; o += 12) didx.push({ id: buf.readUInt32LE(o), off: buf.readUInt32LE(o + 4), size: buf.readUInt32LE(o + 8) });
      if (id === 'DATA') dataOff = body;
      if (id === 'HIRC') {
        const n = buf.readUInt32LE(body); let q = body + 4;
        for (let i = 0; i < n && q + 9 <= body + len; i++) {
          const type = buf.readUInt8(q), size = buf.readUInt32LE(q + 1), oid = buf.readUInt32LE(q + 5);
          objects.set(oid, { type, data: buf.subarray(q + 9, q + 5 + size), bank: e.id }); typeCount[type] = (typeCount[type] || 0) + 1;
          q += 5 + size;
        }
      }
      p = body + len;
    }
    for (const d of didx) { const i = riffInfo(buf, dataOff + d.off, d.size); if (i) clips.set(d.id, { ...i, where: `bank ${e.id}` }); }
    say(`bank ${e.id}: version ${bankVer}; chunks ${chunks.join(' ')}; embedded clips ${didx.length}`);
  }
  say(`HIRC objects by type id: ${JSON.stringify(typeCount)}  (total ${objects.size})`);
});

// ---------------------------------------------------------------- clip summary
safe('clips', () => {
  const hist = {}; let total = 0;
  for (const c of clips.values()) { hist[`${c.codec} ${c.ch}ch ${c.rate}Hz`] = (hist[`${c.codec} ${c.ch}ch ${c.rate}Hz`] || 0) + 1; total += c.seconds; }
  say(`clips: ${clips.size}; total about ${total.toFixed(0)} s; formats: ${JSON.stringify(hist)}`);
});

// ---------------------------------------------------------------- links: event -> objects -> clips (by scanning for referenced IDs)
const refs = new Map(); // object id -> Set of referenced ids (other objects or clips)
safe('reference scan', () => {
  for (const [id, o] of objects) {
    const set = new Set(), d = o.data;
    for (let i = 0; i + 4 <= d.length; i++) { const v = d.readUInt32LE(i); if (v !== id && v > 0xffff && (objects.has(v) || clips.has(v))) set.add(v); }
    refs.set(id, set);
  }
});
const children = new Map(); // parent id -> ids of objects that reference it (child -> parent links)
safe('parent links', () => { for (const [id, set] of refs) for (const v of set) if (objects.has(v)) { if (!children.has(v)) children.set(v, new Set()); children.get(v).add(id); } });
function reach(start, viaChildren) {
  const seen = new Set([start]), stack = [start], wems = new Set();
  while (stack.length) {
    const id = stack.pop();
    for (const v of refs.get(id) || []) { if (clips.has(v)) wems.add(v); else if (!seen.has(v) && objects.get(v) && objects.get(v).type !== 4) { seen.add(v); stack.push(v); } }
    if (viaChildren) for (const v of children.get(id) || []) if (!seen.has(v) && [2, 5, 6, 7, 9].includes(objects.get(v).type)) { seen.add(v); stack.push(v); }
  }
  return { seen, wems };
}
const rtpcIds = Object.fromEntries(RTPCS.map((n) => [fnv(n), n]));
say('');
say('RTPC name hashes: ' + RTPCS.map((n) => `${n}=${fnv(n)}`).join('  '));
for (const name of EVENTS) safe(`event ${name}`, () => {
  const id = fnv(name), ev = objects.get(id);
  say('');
  if (!ev) { say(`EVENT ${name} (id ${id}): not found in any bank`); return; }
  say(`EVENT ${name} (id ${id}) type ${ev.type} size ${ev.data.length}: ${hex(ev.data, 0, 40)}`);
  for (const a of refs.get(id) || []) {
    const act = objects.get(a); if (!act) continue;
    say(`  action ${a} type ${act.type} size ${act.data.length}: ${hex(act.data, 0, 32)}`);
    for (const t of refs.get(a) || []) {
      const tgt = objects.get(t); if (!tgt) continue;
      const { seen, wems } = reach(t, true);
      say(`    target ${t} type ${tgt.type} size ${tgt.data.length}; reaches ${seen.size} objects, ${wems.size} clips`);
      say(`    target head: ${hex(tgt.data, 0, 64)}`);
      for (const oid of seen) {
        const o = objects.get(oid), found = [];
        for (let i = 0; i + 4 <= o.data.length; i++) { const v = o.data.readUInt32LE(i); if (rtpcIds[v]) found.push(`${rtpcIds[v]}@${i}: ${hex(o.data, i, 72)}`); }
        const own = [...(refs.get(oid) || [])].filter((v) => clips.has(v));
        if (found.length || own.length) {
          say(`      obj ${oid} type ${o.type} size ${o.data.length}${own.length ? ' clips ' + own.join(',') : ''}`);
          for (const f of found.slice(0, 6)) say(`        rtpc ${f}`);
        }
      }
      for (const w of wems) { const c = clips.get(w); say(`      clip ${w}: ${c.codec} ${c.ch}ch ${c.rate}Hz ${c.seconds.toFixed(2)}s ${c.size} bytes${c.hasLoopChunk ? ' loop-marked' : ''}`); }
    }
  }
});

// ---------------------------------------------------------------- raw samples of each object type, to confirm layouts
say('');
safe('samples', () => { const shown = {}; for (const [id, o] of objects) { if ((shown[o.type] = (shown[o.type] || 0) + 1) > 2) continue; say(`sample type ${o.type} id ${id} size ${o.data.length}: ${hex(o.data, 0, 96)}`); } });

const report = path.join(path.dirname(file), 'sound-report.txt');
fs.writeFileSync(report, out.join('\n'));
console.log(out.join('\n'));
console.log(`\nReport saved to: ${report}\nSend that file (or paste its contents) back.`);
