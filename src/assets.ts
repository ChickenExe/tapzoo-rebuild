// Loads the extracted sprite atlases and loose images, and composes atlas sprites
// (which are stored as one or more trimmed parts) into cached canvases.

export interface AtlasSprite {
  atlas: string;
  name: string;
  w: number;
  h: number;
  rects: [number, number, number, number, number, number][];
}

const BASE = './game/';

let atlasIndex: Record<string, AtlasSprite> = {};
let imageNames = new Set<string>();
// Sprite file names (e.g. "cage_Bonobo.png") -> atlas key, for still sprites.
const byFileName = new Map<string, string>();
const atlasImages = new Map<string, HTMLImageElement>();
const looseImages = new Map<string, Promise<HTMLImageElement | null>>();
const looseLoaded = new Map<string, HTMLImageElement | null>();
const composed = new Map<string, HTMLCanvasElement>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`failed to load ${path}`);
  return res.json() as Promise<T>;
}

export async function loadAssets(onProgress: (f: number) => void): Promise<void> {
  atlasIndex = await fetchJson('atlas/index.json');
  imageNames = new Set(await fetchJson<string[]>('img/index.json'));
  for (const [key, s] of Object.entries(atlasIndex)) {
    if (!key.includes('#') && !byFileName.has(s.name)) byFileName.set(s.name, key);
  }
  const atlases = [...new Set(Object.values(atlasIndex).map((s) => s.atlas))];
  let done = 0;
  await Promise.all(
    atlases.map(async (a) => {
      atlasImages.set(a, await loadImage(`${BASE}atlas/${a}.png`));
      onProgress(++done / atlases.length);
    }),
  );
}

/** Resolve a CSV image reference (".pvr" or ".png", sometimes without extension) to an atlas key. */
export function resolveSprite(ref: string | undefined): string | null {
  if (!ref) return null;
  const png = String(ref).replace(/\.(pvr|PNG)$/, '.png');
  const candidates = [png, png.endsWith('.png') ? png : `${png}.png`, png.replace('.png', '_x.png')];
  for (const c of candidates) {
    if (atlasIndex[c]) return c;
    const k = byFileName.get(c);
    if (k) return k;
  }
  return null;
}

/** Frames of the animation atlas that belongs to a still sprite, e.g. cheetah -> cheetahAnim#0..n */
export function animFrames(stillKey: string): string[] {
  const atlas = atlasIndex[stillKey]?.atlas;
  if (!atlas) return [];
  const frames: string[] = [];
  for (let i = 0; atlasIndex[`${atlas}Anim#${i}`]; i++) frames.push(`${atlas}Anim#${i}`);
  return frames;
}

export function hasSprite(key: string): boolean {
  return key in atlasIndex || synthetic.has(key);
}

export function spriteInfo(key: string): AtlasSprite | undefined {
  return atlasIndex[key] ?? synthetic.get(key);
}

// ---------- synthetic sprites: placeholders and user-supplied art ----------

const synthetic = new Map<string, AtlasSprite>();

function registerCanvas(key: string, c: HTMLCanvasElement): string {
  synthetic.set(key, { atlas: '', name: key, w: c.width, h: c.height, rects: [] });
  composed.set(key, c);
  return key;
}

/**
 * Stand-in for items whose art was never bundled (it was streamed from Pocket Gems' servers):
 * a blank square slab on the item's footprint, labelled with its name.
 */
export function placeholderSprite(name: string, w: number, h: number): string {
  const key = `ph:${name}:${w}x${h}`;
  if (synthetic.has(key)) return key;
  const HW = 31.2, HH = 15.6, depth = 10;
  const cw = Math.ceil((w + h) * HW) + 4;
  const ch = Math.ceil((w + h) * HH) + depth + 4;
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d')!;
  // Footprint corners with the bottom corner at the canvas bottom, like original sprites.
  const bx = 2 + h * HW, by = ch - 2;
  const pt = (i: number, j: number) => [bx + (i - j) * HW, by - (i + j) * HH - depth] as const;
  const [b, r, t, l] = [pt(0, 0), pt(w, 0), pt(w, h), pt(0, h)];
  g.lineJoin = 'round';
  g.fillStyle = '#c9c2b4';
  g.beginPath();
  g.moveTo(l[0], l[1]);
  g.lineTo(b[0], b[1]);
  g.lineTo(r[0], r[1]);
  g.lineTo(r[0], r[1] + depth);
  g.lineTo(b[0], b[1] + depth);
  g.lineTo(l[0], l[1] + depth);
  g.closePath();
  g.fill();
  g.fillStyle = '#f2eee6';
  g.strokeStyle = '#9d9483';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(b[0], b[1]);
  g.lineTo(r[0], r[1]);
  g.lineTo(t[0], t[1]);
  g.lineTo(l[0], l[1]);
  g.closePath();
  g.fill();
  g.stroke();
  const fs = Math.max(9, Math.min(15, 6 + (w + h) * 1.5));
  g.font = `bold ${fs}px "Trebuchet MS", sans-serif`;
  g.textAlign = 'center';
  g.fillStyle = '#6b6252';
  const cy = (b[1] + t[1]) / 2;
  const words = name.split(' ');
  const lines: string[] = [];
  for (const wd of words) {
    const last = lines[lines.length - 1];
    if (last && g.measureText(`${last} ${wd}`).width < (w + h) * HW * 0.7) lines[lines.length - 1] = `${last} ${wd}`;
    else lines.push(wd);
  }
  lines.forEach((ln, k) => g.fillText(ln, bx + ((w - h) * HW) / 2, cy + (k - (lines.length - 1) / 2) * fs + fs / 3));
  return registerCanvas(key, c);
}

/** Item names that have an override image in public/custom-art/ (e.g. AI-made art). */
let customArt = new Set<string>();
const customLoaded = new Map<string, string | null>();

export async function loadCustomArtIndex(): Promise<void> {
  try {
    const res = await fetch('./custom-art/index.json');
    if (res.ok) customArt = new Set(await res.json());
  } catch {
    customArt = new Set();
  }
}

/** Loads custom art for an item if present; resolves to a sprite key. */
export async function loadCustomArt(name: string): Promise<string | null> {
  const file = `${name}.png`;
  if (!customArt.has(file)) return null;
  if (customLoaded.has(name)) return customLoaded.get(name)!;
  try {
    const img = await loadImage(`./custom-art/${encodeURIComponent(file)}`);
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.drawImage(img, 0, 0);
    const key = registerCanvas(`custom:${name}`, c);
    customLoaded.set(name, key);
    return key;
  } catch {
    customLoaded.set(name, null);
    return null;
  }
}

/** Composed canvas of an atlas sprite at its logical size. */
export function sprite(key: string): HTMLCanvasElement | null {
  const hit = composed.get(key);
  if (hit) return hit;
  if (key.startsWith('ph:')) {
    const m = key.match(/^ph:(.*):(\d+)x(\d+)$/);
    return m ? composed.get(placeholderSprite(m[1], +m[2], +m[3])) ?? null : null;
  }
  const s = atlasIndex[key];
  const img = s && atlasImages.get(s.atlas);
  if (!s || !img) return null;
  const c = document.createElement('canvas');
  c.width = s.w;
  c.height = s.h;
  const g = c.getContext('2d')!;
  for (const [x, y, w, h, ox, oy] of s.rects) g.drawImage(img, x, y, w, h, ox, oy, w, h);
  composed.set(key, c);
  return c;
}

export function hasImage(name: string | undefined): boolean {
  return !!name && imageNames.has(name.replace(/\.PNG$/, '.png'));
}

export function imageUrl(name: string): string {
  return `${BASE}img/${name.replace(/\.PNG$/, '.png')}`;
}

/** Loose image for canvas use; returns null until loaded. */
export function looseImage(name: string): HTMLImageElement | null {
  if (looseLoaded.has(name)) return looseLoaded.get(name)!;
  if (!looseImages.has(name) && hasImage(name)) {
    looseImages.set(
      name,
      loadImage(imageUrl(name))
        .then((img) => (looseLoaded.set(name, img), img))
        .catch(() => (looseLoaded.set(name, null), null)),
    );
  }
  return null;
}

/** A small data-URL thumbnail for any sprite key, used by DOM UI. */
const thumbCache = new Map<string, string>();
export function spriteDataUrl(key: string): string {
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const c = sprite(key);
  if (!c) return '';
  // Crop to the opaque bounds so thumbnails fill their slot.
  const g = c.getContext('2d')!;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const out = document.createElement('canvas');
  out.width = Math.max(1, x1 - x0 + 1);
  out.height = Math.max(1, y1 - y0 + 1);
  out.getContext('2d')!.drawImage(c, -x0, -y0);
  const url = out.toDataURL();
  thumbCache.set(key, url);
  return url;
}
