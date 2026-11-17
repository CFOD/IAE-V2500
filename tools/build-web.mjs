// Builds the browser version into dist-web/: a static site that runs from any web host.
//   node tools/build-web.mjs                 public build: no recordings
//   node tools/build-web.mjs --with-sounds   private build: also copies the recordings in app/sounds
//                                            that sounds.json uses (only those), for a site only you open
// The app is already plain web code; this copies it with the page at the site root, leaves out
// everything that must not be published (sound packs in app/sounds, third-party models in app/assets),
// and adds caching headers and the licence notices. Recordings are loaded by each player from their own
// computer (Sound > Load recordings from a folder), so none are ever on the server.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'dist-web');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const skip = new Set(['sounds', 'assets']);
let n = 0, bytes = 0;
function copy(src, dst, top = false) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (top && skip.has(e.name)) continue;
    if (e.name.startsWith('.')) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copy(s, d); }
    else { fs.copyFileSync(s, d); n++; bytes += fs.statSync(s).size; }
  }
}
copy(path.join(root, 'app'), out, true);            // index.html, main.js ... at the site root
fs.mkdirSync(path.join(out, 'src'), { recursive: true });
copy(path.join(root, 'src'), path.join(out, 'src'));  // the simulation ('../src/...' from the root resolves here)
fs.mkdirSync(path.join(out, 'sounds')); fs.mkdirSync(path.join(out, 'assets'));
let sounds = '';
if (process.argv.includes('--with-sounds')) {
  const dir = path.join(root, 'app', 'sounds'), mf = path.join(dir, 'sounds.json');
  if (!fs.existsSync(mf)) { console.error('--with-sounds: app/sounds/sounds.json not found'); process.exit(1); }
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const used = new Set([...(m.layers || []).map((l) => l.file), ...Object.values(m.shots || {}).map((s) => s.file)]);
  let sb = 0; const missing = [];
  fs.copyFileSync(mf, path.join(out, 'sounds', 'sounds.json'));
  for (const f of used) { const s = path.join(dir, f); if (!fs.existsSync(s)) { missing.push(f); continue; } fs.copyFileSync(s, path.join(out, 'sounds', f)); sb += fs.statSync(s).size; n++; }
  bytes += sb; sounds = `, ${used.size - missing.length} recordings (${(sb / 1048576).toFixed(1)} MB)` + (missing.length ? `; MISSING ${missing.join(', ')}` : '');
}
// Cloudflare Pages / Netlify headers: long cache for the model and libraries, correct type for .glb
fs.writeFileSync(path.join(out, '_headers'), `/*
  X-Content-Type-Options: nosniff
/models/*
  Cache-Control: public, max-age=86400
/vendor/*
  Cache-Control: public, max-age=604800
/fonts/*
  Cache-Control: public, max-age=604800
/*.glb
  Content-Type: model/gltf-binary
`);
if (sounds) fs.appendFileSync(path.join(out, '_headers'), `/sounds/*
  Cache-Control: private, max-age=86400
  X-Robots-Tag: noindex
`);
fs.writeFileSync(path.join(out, 'LICENSES.txt'), [
  'V2500 Engine Simulator - third-party components',
  '',
  'three.js - MIT License, see vendor/THREE-LICENSE',
  'Inter and B612 Mono fonts - SIL Open Font License 1.1, see fonts/OFL-LICENSE and fonts/INTER-LICENSE',
  'Compressor and turbine maps (src/sim/maps/jt9d.js) - from NASA T-MATS, Example_JT9D.',
  '  Copyright United States Government as represented by the Administrator of NASA.',
  '  Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0',
  '  Source: https://github.com/nasa/T-MATS. Scaled and adapted for this engine (see the project documentation).',
  '',
].join('\n'));
fs.writeFileSync(path.join(out, '404.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/"><title>V2500</title><a href="/">V2500 Engine Simulator</a>');
console.log(`dist-web/: ${n} files, ${(bytes / 1048576).toFixed(1)} MB${sounds || ' (no sound pack)'}, no third-party models`);
