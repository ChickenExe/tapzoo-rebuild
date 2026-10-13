// Canvas renderer, camera and pointer input for the zoo.
import { looseImage, placeholderSprite, resolveSprite, sprite, spriteInfo } from './assets';
import { items, ItemType, visitorTypes } from './data';
import { Game, ZooObject } from './game';
import { DIRS, footprint, HW, P, Pt, tileAt } from './iso';
import { prefs } from './prefs';

/** Compact countdown for labels under habitats: 45s, 12m, 3h 5m, 2d 4h. */
function shortTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// Map pieces are 5x5-tile chunks (312 x 156 px plus a shoreline lip); P(x, y) is the bottom
// corner of the chunk, which sits at the bottom-centre of its image.
const PIECE_ANCHOR = { x: -156, y: -156 };
const COIN_BURST = Array.from({ length: 13 }, (_, i) => `3by3coinanimation${String(i + 1).padStart(4, '0')}.png`);
const FIREWORK = Array.from({ length: 7 }, (_, i) => `Firework_2_${i + 1}.png`);

interface Walker {
  base: string;
  i: number;
  j: number;
  ti: number;
  tj: number;
  t: number;
  speed: number;
  frame: number;
  life: number;
  keeper?: boolean;
}

interface Fx {
  text: string;
  color: string;
  x: number;
  y: number;
  t: number;
}

interface SpriteFx {
  frames: string[];
  x: number;
  y: number;
  t: number;
  fps: number;
}

interface Wave {
  key: 'E' | 'N';
  x: number;
  y: number;
  t: number;
}

export interface Ghost {
  type: ItemType;
  i: number;
  j: number;
  flip: boolean;
  moving?: ZooObject;
  fromInventory?: boolean;
  /** Set once the player has picked a spot; the confirm tab shows. */
  proposed?: boolean;
}

export interface ViewHandlers {
  objectTapped(o: ZooObject, screen: Pt): void;
  gateTapped(): void;
  /** The mouse passed over a piece of trash (cleaning is hover, so animals in front don't block it). */
  trashHovered(o: ZooObject): void;
  /** The thing under the mouse changed (null when over nothing), for tooltips. */
  hovered(o: ZooObject | null, screen: Pt): void;
  signTapped(): void;
  groundTapped(): void;
  ghostPlaced(g: Ghost): void;
  ghostChanged(): void;
}

export class View {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  cam = { x: 400, y: 0, zoom: 1 };
  ghost: Ghost | null = null;
  debugGrid = false;
  /** The zoo on screen: home, or the neighbor while visiting. */
  world: Game;
  private walkers: Walker[] = [];
  private fx: Fx[] = [];
  private spriteFx: SpriteFx[] = [];
  private waves: Wave[] = [];
  private last = performance.now();
  private alphaCache = new Map<string, Uint8ClampedArray>();
  private dpr = 1;

  constructor(readonly home: Game, private handlers: ViewHandlers) {
    this.world = home;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'zoo';
    this.g = this.canvas.getContext('2d')!;
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.bindInput();
    this.centerCamera();
    requestAnimationFrame((t) => this.frame(t));
  }

  get visiting(): boolean {
    return this.world !== this.home;
  }

  setWorld(w: Game): void {
    this.world = w;
    this.ghost = null;
    this.walkers = [];
    this.waves = [];
    this.centerCamera();
  }

  centerCamera(): void {
    const c = this.mapCenter();
    this.cam.x = c.x;
    this.cam.y = c.y;
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
  }

  mapCenter(): Pt {
    const land = [...this.world.land()].map((k) => k.split(',').map(Number));
    if (!land.length) return { x: 0, y: 0 };
    let x = 0, y = 0;
    for (const [i, j] of land) {
      const p = P(i + 0.5, j + 0.5);
      x += p.x;
      y += p.y;
    }
    return { x: x / land.length, y: y / land.length };
  }

  // ---------- coordinates ----------

  toWorld(sx: number, sy: number): Pt {
    return {
      x: (sx - window.innerWidth / 2) / this.cam.zoom + this.cam.x,
      y: (sy - window.innerHeight / 2) / this.cam.zoom + this.cam.y,
    };
  }

  toScreen(wx: number, wy: number): Pt {
    return {
      x: (wx - this.cam.x) * this.cam.zoom + window.innerWidth / 2,
      y: (wy - this.cam.y) * this.cam.zoom + window.innerHeight / 2,
    };
  }

  /** Top-left world position of an object's sprite canvas. */
  spritePos(key: string, x: number, y: number, w: number, h: number): Pt {
    const s = spriteInfo(key)!;
    const f = footprint(x, y, w, h);
    const cx = (f.left.x + f.right.x) / 2;
    // Footprint diamonds are drawn into the bottom of each canvas.
    const slack = (s.w - (w + h) * HW) / 2;
    return { x: cx - s.w / 2, y: f.bottom.y + slack / 2 - s.h };
  }

  // ---------- input ----------

  private bindInput(): void {
    const c = this.canvas;
    const pointers = new Map<number, Pt>();
    let dragDist = 0;
    let pinchStart = 0;
    let zoomStart = 1;
    let painting = false;
    let draggingGhost = false;

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragDist = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        zoomStart = this.cam.zoom;
      }
      const gh = this.ghost;
      if (gh) {
        painting = !!gh.type.smartFamily && !gh.moving && !gh.fromInventory;
        // Grab a proposed object to drag it around.
        const t = tileAt(this.toWorld(e.clientX, e.clientY).x, this.toWorld(e.clientX, e.clientY).y);
        const [w, h] = gh.flip ? [gh.type.h, gh.type.w] : [gh.type.w, gh.type.h];
        draggingGhost = !painting && (!gh.proposed || (t.i >= gh.i && t.i < gh.i + w && t.j >= gh.j && t.j < gh.j + h));
        if (painting || draggingGhost) this.updateGhost(e.clientX, e.clientY);
        if (painting) this.handlers.ghostPlaced(gh);
      }
    });

    c.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!this.ghost) this.sweepTrash(e.clientX, e.clientY);
      if (!prev && !this.ghost) {
        const w = this.toWorld(e.clientX, e.clientY);
        const t = tileAt(w.x, w.y);
        const under = this.hitTest(w.x, w.y) ?? this.world.objectAt(t.i, t.j) ?? null;
        this.handlers.hovered(under && items.get(under.type)!.category !== 'path' ? under : null, { x: e.clientX, y: e.clientY });
      } else this.handlers.hovered(null, { x: e.clientX, y: e.clientY });
      if (this.ghost && !prev && !this.ghost.proposed) this.updateGhost(e.clientX, e.clientY);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        this.setZoom(zoomStart * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart));
        dragDist = 99;
        return;
      }
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      dragDist += Math.abs(dx) + Math.abs(dy);
      if (this.ghost && painting) {
        const before = `${this.ghost.i},${this.ghost.j}`;
        this.updateGhost(e.clientX, e.clientY);
        if (`${this.ghost.i},${this.ghost.j}` !== before) this.handlers.ghostPlaced(this.ghost);
        return;
      }
      if (this.ghost && draggingGhost) {
        this.updateGhost(e.clientX, e.clientY);
        return;
      }
      this.cam.x -= dx / this.cam.zoom;
      this.cam.y -= dy / this.cam.zoom;
      this.clampCam();
    });

    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size > 0) return;
      const wasPainting = painting, wasDragging = draggingGhost;
      painting = draggingGhost = false;
      const gh = this.ghost;
      if (gh) {
        if (wasPainting) return;
        if (wasDragging || dragDist <= 8) {
          if (dragDist <= 8) this.updateGhost(e.clientX, e.clientY);
          // Propose the spot; the ✓ / ✗ / ↻ tab confirms (ProposedObjectTabController).
          gh.proposed = true;
          this.handlers.ghostChanged();
        }
        return;
      }
      if (dragDist > 8) return;
      this.tap(e.clientX, e.clientY);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId));

    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const before = this.toWorld(e.clientX, e.clientY);
        this.setZoom(this.cam.zoom * Math.exp(-e.deltaY * 0.0015));
        const after = this.toWorld(e.clientX, e.clientY);
        this.cam.x += before.x - after.x;
        this.cam.y += before.y - after.y;
        this.clampCam();
      },
      { passive: false },
    );
  }

  setZoom(z: number): void {
    this.cam.zoom = Math.min(2, Math.max(0.3, z));
  }

  private clampCam(): void {
    const c = this.mapCenter();
    const r = 60 * HW;
    this.cam.x = Math.min(c.x + r, Math.max(c.x - r, this.cam.x));
    this.cam.y = Math.min(c.y + r / 2, Math.max(c.y - r / 2, this.cam.y));
  }

  updateGhost(sx: number, sy: number): void {
    if (!this.ghost) return;
    const w = this.toWorld(sx, sy);
    const [gw, gh] = this.ghost.flip ? [this.ghost.type.h, this.ghost.type.w] : [this.ghost.type.w, this.ghost.type.h];
    const t = tileAt(w.x, w.y);
    this.ghost.i = t.i - Math.floor((gw - 1) / 2);
    this.ghost.j = t.j - Math.floor((gh - 1) / 2);
    this.handlers.ghostChanged();
  }

  /** Screen position just above the ghost, for the confirm tab. */
  ghostScreenAnchor(): Pt | null {
    const gh = this.ghost;
    if (!gh) return null;
    const [w, h] = gh.flip ? [gh.type.h, gh.type.w] : [gh.type.w, gh.type.h];
    const key = gh.type.sprite;
    const f = footprint(gh.i, gh.j, w, h);
    const top = key ? this.spritePos(key, gh.i, gh.j, w, h).y : f.top.y - 40;
    return this.toScreen((f.left.x + f.right.x) / 2, Math.min(top, f.top.y));
  }

  private tap(sx: number, sy: number): void {
    const w = this.toWorld(sx, sy);
    const hit = this.hitTest(w.x, w.y);
    const gate = this.world.s.objects.find((o) => o.type === 'FrontGateEast');
    if (hit && (hit === gate || hit.type === 'FrontGateWest')) return this.handlers.gateTapped();
    if (hit) return this.handlers.objectTapped(hit, { x: sx, y: sy });
    if (this.signHit(w.x, w.y)) return this.handlers.signTapped();
    // Fall back to the tile under the pointer (flat things like paths).
    const t = tileAt(w.x, w.y);
    const o = this.world.objectAt(t.i, t.j);
    if (o) this.handlers.objectTapped(o, { x: sx, y: sy });
    else this.handlers.groundTapped();
  }

  /** Trash under the cursor: its tile, or its own sprite, ignoring anything drawn in front. */
  private sweepTrash(sx: number, sy: number): void {
    const w = this.toWorld(sx, sy);
    const t = tileAt(w.x, w.y);
    const onTile = this.world.objectAt(t.i, t.j);
    if (onTile && items.get(onTile.type)!.rowType === 'Trash') return this.handlers.trashHovered(onTile);
    for (const o of this.world.s.objects) {
      const it = items.get(o.type)!;
      if (it.rowType !== 'Trash' || !it.sprite) continue;
      const p = this.spritePos(it.sprite, o.x, o.y, 1, 1);
      const s = spriteInfo(it.sprite)!;
      let lx = w.x - p.x;
      if (this.flipped(o, it)) lx = s.w - lx;
      if (this.alphaAt(it.sprite, lx, w.y - p.y) > 20) return this.handlers.trashHovered(o);
    }
  }

  private alphaAt(key: string, px: number, py: number): number {
    let a = this.alphaCache.get(key);
    const c = sprite(key);
    if (!c) return 0;
    if (!a) {
      a = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      this.alphaCache.set(key, a);
    }
    px = Math.floor(px);
    py = Math.floor(py);
    if (px < 0 || py < 0 || px >= c.width || py >= c.height) return 0;
    return a[(py * c.width + px) * 4 + 3];
  }

  private opaqueTops = new Map<string, number>();

  /** First non-transparent row of a sprite, so bubbles sit just above what's visible. */
  private opaqueTop(key: string): number {
    let top = this.opaqueTops.get(key);
    if (top === undefined) {
      const s = spriteInfo(key);
      top = 0;
      if (s) {
        outer: for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x += 2) if (this.alphaAt(key, x, y) > 40) { top = y; break outer; }
      }
      this.opaqueTops.set(key, top);
    }
    return top;
  }

  private hitTest(wx: number, wy: number): ZooObject | null {
    for (const o of this.sortedObjects().reverse()) {
      const t = items.get(o.type)!;
      if (t.category === 'path') continue;
      const key = this.spriteKeyFor(o, t, 0);
      if (!key) continue;
      const [w, h] = this.world.dims(o, t);
      const p = this.spritePos(key, o.x, o.y, w, h);
      const s = spriteInfo(key)!;
      let lx = wx - p.x;
      const ly = wy - p.y;
      if (this.flipped(o, t)) lx = s.w - lx;
      if (this.alphaAt(key, lx, ly) > 20) return o;
    }
    return null;
  }

  private signPos(): Pt | null {
    if (this.visiting || !this.world.nextMap()) return null;
    const [i, j] = this.world.map.signs[0];
    return P(i + 0.5, j + 0.5);
  }

  private signHit(wx: number, wy: number): boolean {
    const p = this.signPos();
    return !!p && Math.abs(wx - p.x) < 50 && wy > p.y - 90 && wy < p.y + 20;
  }

  // ---------- effects ----------

  addFx(text: string, color: string, wx: number, wy: number): void {
    this.fx.push({ text, color, x: wx, y: wy, t: 0 });
  }

  coinBurst(o: ZooObject): void {
    const a = this.objectAnchor(o);
    this.spriteFx.push({ frames: COIN_BURST, x: a.x - 100, y: a.y - 130, t: 0, fps: 24 });
  }

  fireworks(): void {
    const c = this.toWorld(window.innerWidth / 2, window.innerHeight / 2);
    for (let k = 0; k < 6; k++) {
      this.spriteFx.push({
        frames: FIREWORK,
        x: c.x - 64 + (Math.random() - 0.5) * 500 / this.cam.zoom,
        y: c.y - 64 + (Math.random() - 0.5) * 300 / this.cam.zoom,
        t: -k * 0.25,
        fps: 10,
      });
    }
  }

  objectAnchor(o: ZooObject): Pt {
    const t = items.get(o.type)!;
    const [w, h] = this.world.dims(o, t);
    const c = P(o.x + w / 2, o.y + h / 2);
    return { x: c.x, y: c.y - 40 };
  }

  // ---------- simulation ----------

  private walkable(i: number, j: number): boolean {
    if (!this.world.land().has(`${i},${j}`)) return false;
    if (this.world.isPath(i, j)) return true;
    return !this.world.objectAt(i, j);
  }

  private visitorPool(): ItemType[] {
    return visitorTypes.filter((v) => !v.locked || this.world.s.unlocked.includes(v.name));
  }

  private updateWalkers(dt: number): void {
    const animals = this.world.s.objects.filter((o) => items.get(o.type)!.category === 'animal').length;
    const visitorsWanted = Math.min(4 + Math.floor(animals * 1.5), 24);
    const entrance = { i: 0, j: 2 };
    const pool = this.visitorPool();
    if (this.walkers.filter((w) => !w.keeper).length < visitorsWanted && Math.random() < dt * 0.6 && pool.length) {
      const vt = pool[Math.floor(Math.random() * pool.length)];
      this.walkers.push({ base: vt.walkBase!, ...entrance, ti: entrance.i, tj: entrance.j, t: 1, speed: 1.1 + Math.random() * 0.5, frame: 0, life: 40 + Math.random() * 60 });
    }
    const keepers = this.world.s.objects.filter((o) => items.get(o.type)!.category === 'staff');
    for (const k of keepers) {
      if (!this.walkers.some((w) => w.keeper && w.base === `${items.get(k.type)!.walkBase}#${k.id}`)) {
        this.walkers.push({ base: `${items.get(k.type)!.walkBase}#${k.id}`, i: k.x, j: k.y, ti: k.x, tj: k.y, t: 1, speed: 1.4, frame: 0, life: Infinity, keeper: true });
      }
    }
    this.walkers = this.walkers.filter((w) => !w.keeper || keepers.some((k) => w.base.endsWith(`#${k.id}`)));

    for (const w of this.walkers) {
      w.t += dt * w.speed;
      w.frame += dt * 8;
      w.life -= dt;
      if (w.t < 1) continue;
      w.i = w.ti;
      w.j = w.tj;
      w.t = 0;
      // Prefer paths.
      const opts = DIRS.map((d) => ({ i: w.i + d.di, j: w.j + d.dj })).filter((n) => this.walkable(n.i, n.j));
      const onPath = opts.filter((n) => this.world.isPath(n.i, n.j));
      const choices = onPath.length && Math.random() < 0.85 ? onPath : opts;
      if (!choices.length) continue;
      const n = choices[Math.floor(Math.random() * choices.length)];
      w.ti = n.i;
      w.tj = n.j;
    }
    this.walkers = this.walkers.filter((w) => w.keeper || w.life > -3);
  }

  /** Shoreline tiles: land tiles with water down-left (wave_N) or down-right (wave_E). */
  private shore: { idx: number; pts: Wave[] } | null = null;
  private updateWaves(dt: number): void {
    const idx = this.world.s.mapIndex + (this.visiting ? 1000 : 0);
    if (this.shore?.idx !== idx) {
      const land = this.world.land();
      const pts: Wave[] = [];
      for (const k of land) {
        const [i, j] = k.split(',').map(Number);
        if (!land.has(`${i - 1},${j}`)) {
          const p = P(i - 0.6, j + 0.5);
          pts.push({ key: 'N', x: p.x, y: p.y, t: 0 });
        }
        if (!land.has(`${i},${j - 1}`)) {
          const p = P(i + 0.5, j - 0.6);
          pts.push({ key: 'E', x: p.x, y: p.y, t: 0 });
        }
      }
      this.shore = { idx, pts };
      this.waves = [];
    }
    if (this.shore.pts.length && this.waves.length < 6 && Math.random() < dt * 2) {
      const p = this.shore.pts[Math.floor(Math.random() * this.shore.pts.length)];
      this.waves.push({ ...p, t: 0 });
    }
    for (const w of this.waves) w.t += dt;
    this.waves = this.waves.filter((w) => w.t < 1.4);
  }

  // ---------- drawing ----------

  private spriteKeyFor(o: ZooObject, t: ItemType, now: number): string | null {
    if (t.smartFamily) return this.world.smartVariant(o).sprite;
    if (t.frames.length && now) {
      // Play the habitat animation, then idle on the still frame for a moment.
      const cycle = t.frames.length * t.frameMs + 2500;
      const phase = (now + o.id * 977) % cycle;
      const f = Math.floor(phase / t.frameMs);
      if (f < t.frames.length) return t.frames[f];
    }
    return t.sprite;
  }

  private flipped(o: ZooObject, t: ItemType): boolean {
    const v = t.smartFamily ? this.world.smartVariant(o) : t;
    // Placeholders carry a text label, so never mirror them.
    if (v.missingArt) return false;
    return v.xflip !== o.flip;
  }

  private isFlat(t: ItemType): boolean {
    return t.category === 'path' && !/Shrub/.test(t.smartFamily ?? t.rowType);
  }

  private sortedObjects(): ZooObject[] {
    const boxes = new Map(
      this.world.s.objects.map((o) => {
        const t = items.get(o.type)!;
        const [w, h] = this.world.dims(o, t);
        return [o, { x: o.x, y: o.y, w, h, flat: this.isFlat(t) }];
      }),
    );
    return [...this.world.s.objects].filter((o) => items.get(o.type)!.category !== 'staff').sort((a, b) => paintOrder(boxes.get(a)!, boxes.get(b)!));
  }

  /** `pad` stretches the sprite slightly so adjacent terrain pieces don't show hairline seams. */
  private drawSprite(key: string, x: number, y: number, flip: boolean, alpha = 1, pad = 0): void {
    const c = sprite(key);
    if (!c) return;
    const g = this.g;
    g.globalAlpha = alpha;
    if (flip) {
      g.save();
      g.translate(x + c.width, y);
      g.scale(-1, 1);
      g.drawImage(c, -pad, 0, c.width + pad, c.height + pad);
      g.restore();
    } else g.drawImage(c, x, y, c.width + pad, c.height + pad);
    g.globalAlpha = 1;
  }

  private diamond(i: number, j: number, w: number, h: number): void {
    const g = this.g;
    const a = P(i, j), b = P(i + w, j), c = P(i + w, j + h), d = P(i, j + h);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.lineTo(c.x, c.y);
    g.lineTo(d.x, d.y);
    g.closePath();
  }

  private frame(t: number): void {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.updateWalkers(dt);
    this.updateWaves(dt);
    this.draw(Date.now(), t, dt);
    requestAnimationFrame((tt) => this.frame(tt));
  }

  private draw(now: number, perf: number, dt: number): void {
    const g = this.g;
    const W = window.innerWidth, H = window.innerHeight;
    const world = this.world;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#7fd3f0';
    g.fillRect(0, 0, W, H);
    g.translate(W / 2, H / 2);
    g.scale(this.cam.zoom, this.cam.zoom);
    g.translate(-this.cam.x, -this.cam.y);
    g.imageSmoothingQuality = 'high';

    // Waves lapping the shore, under the island.
    for (const w of this.waves) {
      const f = Math.min(10, 1 + Math.floor((w.t / 1.4) * 10));
      const key = resolveSprite(`wave_${w.key}_${f}.png`);
      if (key) this.drawSprite(key, w.x - 64, w.y - 36, false, Math.min(1, 2 - w.t * 1.4));
    }

    // Terrain.
    for (const p of world.map.pieces) {
      if (!p.sprite) continue;
      const pos = P(p.x, p.y);
      this.drawSprite(p.sprite, pos.x + PIECE_ANCHOR.x, pos.y + PIECE_ANCHOR.y, p.flip, 1, 1);
    }

    if (this.debugGrid || this.ghost) {
      g.lineWidth = 1 / this.cam.zoom;
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      for (const k of world.land()) {
        const [i, j] = k.split(',').map(Number);
        this.diamond(i, j, 1, 1);
        g.stroke();
        if (this.debugGrid) {
          const c = P(i + 0.5, j + 0.5);
          g.fillStyle = '#000';
          g.font = '9px sans-serif';
          g.fillText(`${i},${j}`, c.x - 10, c.y + 3);
        }
      }
    }

    // Objects and walkers in painter's order.
    type Drawable = Box & { draw: () => void };
    const list: Drawable[] = [];
    const objs = this.sortedObjects();
    for (const o of objs) {
      const t = items.get(o.type)!;
      if (this.ghost?.moving === o) continue;
      const key = this.spriteKeyFor(o, t, now);
      if (!key) continue;
      const [w, h] = world.dims(o, t);
      const pos = this.spritePos(key, o.x, o.y, w, h);
      const flip = this.flipped(o, t);
      const sick = world.isSick(o, now);
      list.push({
        x: o.x,
        y: o.y,
        w,
        h,
        flat: this.isFlat(t),
        draw: () => {
          if (sick) g.filter = 'grayscale(0.7) brightness(0.9)';
          this.drawSprite(key, pos.x, pos.y, flip);
          g.filter = 'none';
        },
      });
    }
    // Boats wait by the dock (no boat art shipped, so they use the placeholder look).
    const dock = world.dock();
    for (const b of world.s.boats) {
      const bx = (dock?.x ?? 2) - 3, by = (dock?.y ?? -3) - 1;
      const sail = b.sailingSince ? Math.min(1, (now - b.sailingSince) / 6000) : 0;
      if (sail >= 1) continue;
      const ph = placeholderSprite(b.type.replace('boatstage', 'Boat (stage ') + ')', 3, 2);
      const pos = this.spritePos(ph, bx - sail * 20, by - sail * 6, 3, 2);
      list.push({ x: bx, y: by, w: 3, h: 2, flat: false, draw: () => this.drawSprite(ph, pos.x, pos.y, false, 1 - sail) });
    }
    for (const w of this.walkers) {
      const fi = w.i + (w.ti - w.i) * w.t, fj = w.j + (w.tj - w.j) * w.t;
      const di = w.ti - w.i, dj = w.tj - w.j;
      // Sprites face up-right ("ur", +i) or down-right ("dr", -j); mirror them for +j and -i.
      const up = di > 0 || dj > 0;
      const flip = dj > 0 || di < 0;
      const frames = this.walkFrames(w.base.split('#')[0], up ? 'ur' : 'dr');
      if (!frames.length) continue;
      const key = frames[Math.floor(w.frame) % frames.length];
      const c = P(fi + 0.5, fj + 0.5);
      list.push({
        x: fi + 0.2,
        y: fj + 0.2,
        w: 0.6,
        h: 0.6,
        flat: false,
        draw: () => this.drawSprite(key, c.x - 32, c.y - 66, flip, w.life < 0 ? Math.max(0, 1 + w.life / 3) : 1),
      });
    }
    list.sort(paintOrder);
    for (const d of list) d.draw();

    // Expansion sign.
    const sign = this.signPos();
    if (sign) {
      const key = world.s.landBuildUntil ? null : resolveSprite('land_north.png');
      if (key) this.drawSprite(key, sign.x - 57, sign.y - 50 + Math.sin(perf / 300) * 3, false);
    }

    this.drawBubbles(objs, now, perf);
    this.drawGhost();

    // Sprite effects (coin bursts, fireworks).
    for (const f of this.spriteFx) {
      f.t += dt;
      if (f.t < 0) continue;
      const k = resolveSprite(f.frames[Math.floor(f.t * f.fps)] ?? '');
      if (k) this.drawSprite(k, f.x, f.y, false);
    }
    this.spriteFx = this.spriteFx.filter((f) => f.t * f.fps < f.frames.length);

    // Floating rewards.
    g.textAlign = 'center';
    for (const f of this.fx) {
      f.t += dt;
      g.globalAlpha = Math.max(0, 1 - f.t / 1.6);
      g.font = 'bold 22px "Trebuchet MS", sans-serif';
      g.lineWidth = 4;
      g.strokeStyle = '#3b2306';
      const y = f.y - f.t * 50;
      g.strokeText(f.text, f.x, y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, y);
    }
    g.globalAlpha = 1;
    g.textAlign = 'start';
    this.fx = this.fx.filter((f) => f.t < 1.6);
  }

  private drawBubbles(objs: ZooObject[], now: number, perf: number): void {
    const g = this.g;
    const world = this.world;
    const coin = looseImage('coin_45x45.png');
    const egg = looseImage('Egg_Icon.png');
    const sickImg = looseImage('sickImage.png');
    const bob = (o: number) => Math.sin(perf / 250 + o) * 4;
    for (const o of objs) {
      const t = items.get(o.type)!;
      const [w, h] = world.dims(o, t);
      const a = this.objectAnchor(o);
      const key = t.sprite;
      const top = key ? this.spritePos(key, o.x, o.y, w, h).y + this.opaqueTop(key) + 10 : a.y - 40;
      const icons: (HTMLImageElement | string)[] = [];
      const nest = world.nestFor(o);
      if (nest) {
        const st = world.nestState(nest, now);
        if (st === 'sick' && sickImg) icons.push(sickImg);
        else if (egg) icons.push(egg);
      }
      if (world.isReady(o, now) && coin) icons.push(coin);
      if (world.hasExclamation(o)) icons.push('!');
      icons.forEach((ic, k) => {
        const x = a.x - 22 + (k - (icons.length - 1) / 2) * 46;
        if (ic === '!') {
          const ek = resolveSprite('2by2exclamation_centered.png');
          if (ek) this.drawSprite(ek, x - 43, top - 80 + bob(o.id), false);
        } else if (ic === sickImg) {
          // The "Sick" label is authored sideways for the landscape device; draw it upright.
          g.save();
          g.translate(x + 22, top - 22 + bob(o.id));
          g.rotate(-Math.PI / 2);
          g.drawImage(ic, -ic.width / 2, -ic.height / 2);
          g.restore();
        } else g.drawImage(ic as HTMLImageElement, x, top - 44 + bob(o.id + k), 44, 44);
      });
    }
    if (prefs.showTimers) this.drawTimers(objs, now);
    // Ticket money waiting at the gate.
    const gate = world.s.objects.find((o) => o.type === 'FrontGateEast');
    if (gate && !this.visiting && coin && world.pendingRevenue(now) >= Math.max(5, world.s.ticketPrice * 10)) {
      const p = P(gate.x + 0.5, gate.y + 1);
      g.drawImage(coin, p.x - 22, p.y - 150 + bob(7), 44, 44);
    }
  }

  /** Optional countdowns under producing objects and incubating eggs (Settings → timers). */
  private drawTimers(objs: ZooObject[], now: number): void {
    const g = this.g;
    const world = this.world;
    g.font = 'bold 12px "Trebuchet MS", sans-serif';
    g.textAlign = 'center';
    for (const o of objs) {
      const t = items.get(o.type)!;
      const parts: string[] = [];
      if (t.harvestCoins && !world.isReady(o, now) && !world.isSick(o, now)) parts.push(`🪙 ${shortTime(world.readyAt(o) - now)}`);
      const nest = world.nestFor(o);
      if (nest && world.nestState(nest, now) === 'incubating') parts.push(`🥚 ${shortTime(nest.end - now)}`);
      if (!parts.length) continue;
      const [w, h] = world.dims(o, t);
      const b = footprint(o.x, o.y, w, h).bottom;
      const text = parts.join('  ');
      const tw = g.measureText(text).width + 12;
      g.fillStyle = 'rgba(58,36,8,0.85)';
      g.beginPath();
      g.roundRect(b.x - tw / 2, b.y + 2, tw, 18, 9);
      g.fill();
      g.fillStyle = '#fff4d2';
      g.fillText(text, b.x, b.y + 15);
    }
    g.textAlign = 'start';
  }

  private drawGhost(): void {
    const gh = this.ghost;
    if (!gh) return;
    const g = this.g;
    const [w, h] = gh.flip ? [gh.type.h, gh.type.w] : [gh.type.w, gh.type.h];
    const ok = this.world.canPlace(gh.type, gh.i, gh.j, gh.flip, gh.moving);
    this.diamond(gh.i, gh.j, w, h);
    g.fillStyle = ok ? 'rgba(80,255,80,0.35)' : 'rgba(255,60,60,0.4)';
    g.fill();
    const key = gh.type.smartFamily ? items.get(`${gh.type.smartFamily}15`)?.sprite ?? gh.type.sprite : gh.type.sprite;
    if (key) {
      const pos = this.spritePos(key, gh.i, gh.j, w, h);
      this.drawSprite(key, pos.x, pos.y, !gh.type.missingArt && gh.flip !== gh.type.xflip, 0.75);
    }
  }

  private walkCache = new Map<string, string[]>();
  private walkFrames(base: string, dir: string): string[] {
    const k = `${base}_${dir}`;
    let f = this.walkCache.get(k);
    if (!f) {
      f = [];
      for (let n = 1; n < 12; n++) {
        const s = resolveSprite(`${base}_${dir}_${n}.png`);
        if (!s) break;
        f.push(s);
      }
      this.walkCache.set(k, f);
    }
    return f;
  }
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  flat: boolean;
}

/** Back-to-front order for footprints on the grid; flat ground tiles always go first. */
function paintOrder(a: Box, b: Box): number {
  if (a.flat !== b.flat) return a.flat ? -1 : 1;
  if (a.x >= b.x + b.w || a.y >= b.y + b.h) return -1;
  if (b.x >= a.x + a.w || b.y >= a.y + a.h) return 1;
  return b.x + b.y + (b.w + b.h) / 2 - (a.x + a.y + (a.w + a.h) / 2);
}
