// Converts the original Tap Zoo IPA into web-friendly assets under public/game/.
// Usage: node tools/extract.mjs [path/to/Tap_Zoo.ipa]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import { unzipSync } from 'fflate';
import { PNG } from 'pngjs';

const ipaPath = process.argv[2] ?? path.join(os.homedir(), 'Desktop', 'Tap_Zoo_2.5.7_ios_3.0.ipa');
const outDir = path.resolve('public/game');

// ---------- PNG (Apple CgBI) ----------

function readChunks(buf) {
  const chunks = [];
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    chunks.push({ type, data: buf.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Decodes a PNG (plain or CgBI) to straight-alpha RGBA.
function decodePng(buf) {
  const chunks = readChunks(buf);
  const isCgBI = chunks[0].type === 'CgBI';
  if (!isCgBI) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4);
  const depth = ihdr[8], colorType = ihdr[9], interlace = ihdr[12];
  if (depth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported CgBI png: depth=${depth} color=${colorType}`);
  }
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateRawSync(idat);
  const bpp = colorType === 6 ? 4 : 3;
  const pix = Buffer.alloc(width * height * bpp);
  // Adam7 passes: [x0, y0, dx, dy]; a non-interlaced image is a single full pass.
  const passes = interlace
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]];
  let pos = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = pw * bpp;
    const sub = Buffer.alloc(stride * ph);
    for (let y = 0; y < ph; y++) {
      const ft = raw[pos];
      const src = pos + 1, dst = y * stride, prev = dst - stride;
      for (let x = 0; x < stride; x++) {
        const v = raw[src + x];
        const a = x >= bpp ? sub[dst + x - bpp] : 0;
        const b = y > 0 ? sub[prev + x] : 0;
        const c = x >= bpp && y > 0 ? sub[prev + x - bpp] : 0;
        sub[dst + x] = (v + (ft === 0 ? 0 : ft === 1 ? a : ft === 2 ? b : ft === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 255;
      }
      pos += stride + 1;
    }
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        sub.copy(pix, ((y0 + y * dy) * width + x0 + x * dx) * bpp, (y * pw + x) * bpp, (y * pw + x + 1) * bpp);
      }
    }
  }
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < pix.length; i += bpp, j += 4) {
    // CgBI stores BGR(A), alpha-premultiplied.
    const al = bpp === 4 ? pix[i + 3] : 255;
    const un = (v) => (al === 0 ? 0 : al === 255 ? v : Math.min(255, Math.round((v * 255) / al)));
    out[j] = un(pix[i + 2]);
    out[j + 1] = un(pix[i + 1]);
    out[j + 2] = un(pix[i]);
    out[j + 3] = al;
  }
  return { width, height, data: out };
}

function writePng(file, img) {
  const png = new PNG({ width: img.width, height: img.height });
  img.data.copy(png.data);
  fs.writeFileSync(file, PNG.sync.write(png));
}

// ---------- Atlas .dat ----------
// u16 version, u16 count, then count entries:
//   v0: [offset, parts, w, h]   v1: [offset, parts, w, h, animGroup, frameIndex]
// At offset: parts * [x, y, w, h, drawX, drawY] then a NUL-terminated sprite name.
function parseAtlas(buf) {
  const ver = buf.readUInt16LE(0), count = buf.readUInt16LE(2);
  const es = ver === 1 ? 6 : 4;
  const sprites = [];
  for (let i = 0; i < count; i++) {
    const e = [];
    for (let k = 0; k < es; k++) e.push(buf.readUInt16LE(4 + (i * es + k) * 2));
    const [off, parts, w, h] = e;
    const rects = [];
    for (let p = 0; p < parts; p++) {
      const r = [];
      for (let k = 0; k < 6; k++) r.push(buf.readUInt16LE(off + p * 12 + k * 2));
      rects.push(r);
    }
    const s = off + parts * 12;
    const name = buf.toString('latin1', s, buf.indexOf(0, s));
    sprites.push({ name, w, h, rects, frame: ver === 1 ? e[5] : undefined });
  }
  return sprites;
}

// ---------- CSV ----------
// Row 0 = column names, row 1 = column types; file ends with "!@#<checksum>".
function parseCsvText(text) {
  text = text.split('!@#')[0].replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

function csvToObjects(text) {
  const rows = parseCsvText(text);
  const head = rows[0].map((h) => h.trim());
  const typed = rows[1] && rows[1].every((t) => /^(String|Integer|Float|Double|h|)$/i.test(t.trim()));
  const types = typed ? rows[1].map((t) => t.trim()) : [];
  const body = rows.slice(typed ? 2 : 1);
  return body.map((r) => {
    const o = {};
    head.forEach((h, i) => {
      if (!h || h === 'h') return;
      const v = (r[i] ?? '').trim();
      if (v === '') return;
      const t = types[i];
      o[h] = (t === 'Integer' || t === 'Float' || (!t && /^-?\d+(\.\d+)?$/.test(v))) && !isNaN(Number(v)) ? Number(v) : v;
    });
    return o;
  });
}

// ---------- Audio (CAF / Apple IMA4 -> WAV) ----------

const IMA_INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const IMA_STEP = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411,
  1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
  11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

function cafToWav(buf) {
  if (buf.toString('latin1', 0, 4) !== 'caff') throw new Error('not a CAF file');
  let p = 8, desc = null, data = null;
  while (p < buf.length) {
    const type = buf.toString('latin1', p, p + 4);
    const size = Number(buf.readBigInt64BE(p + 4));
    const body = buf.subarray(p + 12, size < 0 ? buf.length : p + 12 + size);
    if (type === 'desc') desc = { rate: body.readDoubleBE(0), format: body.toString('latin1', 8, 12), channels: body.readUInt32BE(24) };
    if (type === 'data') data = body.subarray(4);
    p += 12 + (size < 0 ? buf.length : size);
  }
  if (!desc || !data || desc.format !== 'ima4') throw new Error(`unsupported CAF audio: ${desc?.format}`);
  const ch = desc.channels, packets = Math.floor(data.length / (34 * ch));
  const pcm = Buffer.alloc(packets * 64 * ch * 2);
  for (let k = 0; k < packets; k++) {
    for (let c = 0; c < ch; c++) {
      const base = (k * ch + c) * 34;
      const header = data.readUInt16BE(base);
      let pred = (header & 0xff80) << 16 >> 16;
      let idx = Math.min(88, header & 0x7f);
      for (let n = 0; n < 64; n++) {
        const byte = data[base + 2 + (n >> 1)];
        const nib = n & 1 ? byte >> 4 : byte & 15;
        const step = IMA_STEP[idx];
        let diff = step >> 3;
        if (nib & 4) diff += step;
        if (nib & 2) diff += step >> 1;
        if (nib & 1) diff += step >> 2;
        pred = Math.max(-32768, Math.min(32767, nib & 8 ? pred - diff : pred + diff));
        idx = Math.max(0, Math.min(88, idx + IMA_INDEX[nib]));
        pcm.writeInt16LE(pred, ((k * 64 + n) * ch + c) * 2);
      }
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(desc.rate, 24);
  h.writeUInt32LE(desc.rate * ch * 2, 28);
  h.writeUInt16LE(ch * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// ---------- main ----------

console.log(`Reading ${ipaPath}`);
const zip = unzipSync(new Uint8Array(fs.readFileSync(ipaPath)));
const prefix = Object.keys(zip).find((k) => /^Payload\/[^/]+\.app\/$/.test(k) || /^Payload\/[^/]+\.app\/Info\.plist$/.test(k)).match(/^Payload\/[^/]+\.app\//)[0];
const files = {};
for (const [k, v] of Object.entries(zip)) {
  if (k.startsWith(prefix) && !k.endsWith('/')) files[k.slice(prefix.length)] = Buffer.from(v);
}

fs.rmSync(outDir, { recursive: true, force: true });
for (const d of ['img', 'atlas', 'data', 'maps', 'sound']) fs.mkdirSync(path.join(outDir, d), { recursive: true });

// Atlases: only the full-resolution sheets (the _25/_50 copies are downscaled duplicates).
const atlasIndex = {};
let atlasCount = 0;
for (const name of Object.keys(files)) {
  const m = name.match(/^(.*)ATLAS\.dat$/);
  if (!m || /_(25|50)$/.test(m[1])) continue;
  const base = m[1];
  const pngName = `${base}ATLAS.png`;
  if (!files[pngName]) continue;
  writePng(path.join(outDir, 'atlas', `${base}.png`), decodePng(files[pngName]));
  for (const s of parseAtlas(files[name])) {
    // Animation atlases contain repeated frame names; key them by frame index.
    const key = s.frame !== undefined && /Anim$/.test(base) ? `${base}#${s.frame}` : s.name;
    atlasIndex[key] = { atlas: base, name: s.name, w: s.w, h: s.h, rects: s.rects };
  }
  atlasCount++;
}
fs.writeFileSync(path.join(outDir, 'atlas', 'index.json'), JSON.stringify(atlasIndex));

// Loose images.
const images = [];
for (const name of Object.keys(files)) {
  if (!/\.png$/i.test(name) || /ATLAS\.png$/.test(name) || name.includes('/')) continue;
  try {
    writePng(path.join(outDir, 'img', name.replace(/\.PNG$/, '.png')), decodePng(files[name]));
    images.push(name.replace(/\.PNG$/, '.png'));
  } catch (err) {
    console.warn(`skip ${name}: ${err.message}`);
  }
}
for (const name of Object.keys(files)) {
  if (/\.jpg$/i.test(name) && !name.includes('/')) {
    fs.writeFileSync(path.join(outDir, 'img', name), files[name]);
    images.push(name);
  }
}
fs.writeFileSync(path.join(outDir, 'img', 'index.json'), JSON.stringify(images.sort()));

// Data tables.
const maps = {};
for (const name of Object.keys(files)) {
  if (!name.endsWith('.csv') || name.includes('/')) continue;
  const objs = csvToObjects(files[name].toString('latin1'));
  const mm = name.match(/^(m\d+)\.csv$/);
  if (mm) {
    maps[mm[1]] = { pieces: objs };
  } else {
    fs.writeFileSync(path.join(outDir, 'data', name.replace('.csv', '.json')), JSON.stringify(objs, null, 1));
  }
}
const tilesOf = (buf) => buf.toString('latin1').split(/\r?\n/).filter(Boolean).map((l) => l.split(',').map(Number));
for (const [id, m] of Object.entries(maps)) {
  if (files[`${id}.walk`]) m.walk = tilesOf(files[`${id}.walk`]);
  if (files[`${id}.place`]) m.place = tilesOf(files[`${id}.place`]);
  fs.writeFileSync(path.join(outDir, 'maps', `${id}.json`), JSON.stringify(m));
}

for (const name of Object.keys(files)) {
  if (!/\.caf$/i.test(name)) continue;
  try {
    fs.writeFileSync(path.join(outDir, 'sound', path.basename(name).replace(/\.caf$/i, '.wav')), cafToWav(files[name]));
  } catch (err) {
    console.warn(`skip ${name}: ${err.message}`);
  }
}

// Bundled demo neighbor ("Sally", hugeZoo.db) for the Visit Neighbor feature.
if (files['hugeZoo.db']) {
  const { DatabaseSync } = await import('node:sqlite');
  const tmp = path.join(os.tmpdir(), `tapzoo-neighbor-${process.pid}.db`);
  fs.writeFileSync(tmp, files['hugeZoo.db']);
  try {
    const db = new DatabaseSync(tmp, { readOnly: true });
    const user = db.prepare('select * from users').get();
    const objects = db.prepare('select dataArray from GameObjects').all().map((r) => JSON.parse(r.dataArray));
    db.close();
    const neighbor = {
      name: user.username,
      xp: Number(user.experience),
      coins: Number(user.coins),
      gold: Number(user.gold),
      mapIndex: Number(user.mapNumber),
      objects: objects.map((o) => ({ name: o.name, x: Number(o.x), y: Number(o.y), count: Number(o.count ?? 1) })),
    };
    fs.writeFileSync(path.join(outDir, 'data', 'neighbor.json'), JSON.stringify(neighbor, null, 1));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// App icon for electron-builder: the 114px iOS icon upscaled to 512px (bilinear).
{
  const src = decodePng(files['Icon@2x.png'] ?? files['Icon.png']);
  const S = 512;
  const out = { width: S, height: S, data: Buffer.alloc(S * S * 4) };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = Math.min(src.width - 1.001, ((x + 0.5) * src.width) / S - 0.5), fy = Math.min(src.height - 1.001, ((y + 0.5) * src.height) / S - 0.5);
      const x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy)), tx = Math.max(0, fx - x0), ty = Math.max(0, fy - y0);
      for (let c = 0; c < 4; c++) {
        const at = (xx, yy) => src.data[(yy * src.width + xx) * 4 + c];
        const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
        const bot = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
        out.data[(y * S + x) * 4 + c] = Math.round(top * (1 - ty) + bot * ty);
      }
    }
  }
  fs.mkdirSync('build', { recursive: true });
  writePng(path.join('build', 'icon.png'), out);
}

console.log(`atlases:${atlasCount}, sprites: ${Object.keys(atlasIndex).length}, images: ${images.length}, maps: ${Object.keys(maps).length}`);
