// Isometric projection used by the original maps (OpenGL, y-up): a tile is a 62.4 x 31.2
// diamond, i runs up-right and j runs up-left. P(i, j) is the bottom corner of tile (i, j),
// and map pieces from mNN.csv sit at P(x, y) as well.
export const HW = 31.2;
export const HH = 15.6;

export interface Pt {
  x: number;
  y: number;
}

export function P(i: number, j: number): Pt {
  return { x: (i - j) * HW, y: -(i + j) * HH };
}

/** Corners of a w x h footprint whose origin tile is (i, j). */
export function footprint(i: number, j: number, w: number, h: number) {
  return { bottom: P(i, j), right: P(i + w, j), top: P(i + w, j + h), left: P(i, j + h) };
}

/** Inverse of P: fractional tile coordinates under a world point. */
export function toTile(x: number, y: number): { i: number; j: number } {
  const a = x / HW;
  const b = -y / HH;
  return { i: (a + b) / 2, j: (b - a) / 2 };
}

export function tileAt(x: number, y: number): { i: number; j: number } {
  const t = toTile(x, y);
  return { i: Math.floor(t.i), j: Math.floor(t.j) };
}

/** Painter's-order key: tiles nearer the bottom of the screen (smaller i + j) draw later. */
export function depthOf(i: number, j: number): number {
  return -(i + j);
}

// Smart-tile neighbour bits as named in SmartObjects.csv (Sidewalk_<mask>).
export const DIRS: { bit: number; di: number; dj: number }[] = [
  { bit: 1, di: 1, dj: 0 }, // N (up-right)
  { bit: 2, di: -1, dj: 0 }, // S (down-left)
  { bit: 4, di: 0, dj: -1 }, // E (down-right)
  { bit: 8, di: 0, dj: 1 }, // W (up-left)
];
