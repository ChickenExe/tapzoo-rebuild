// Zoo state and rules. Numbers (prices, timers, payouts, XP curve, land costs, breeding times,
// recipes) come from the original CSVs. Systems follow the original's class structure
// (AnimalCage, BreedingInventory, CrossBreedingInventory, Grades, TicketPricePanel, ...);
// formulas that lived in the encrypted binary are our own design and are marked as such.
import {
  breedingSlotCosts,
  crossSlotCosts,
  dailyBonus,
  familyBase,
  items,
  ItemType,
  levelForXp,
  levels,
  maps,
  MapDef,
  recipeFor,
} from './data';
import { gradeReport } from './grades';
import { DIRS } from './iso';

export interface ZooObject {
  id: number;
  type: string;
  x: number;
  y: number;
  flip: boolean;
  /** Animals in a habitat. */
  count?: number;
  /** ms timestamp the current production cycle started. */
  cycleStart?: number;
}

/** A nursery nest: one habitat's pair incubating an egg. */
export interface Nest {
  cageId: number;
  start: number;
  end: number;
  revived?: boolean;
}

/** A crossbreeding nest: two parent species producing a hybrid. */
export interface CrossNest {
  result: string;
  a: string;
  b: string;
  start: number;
  end: number;
  revived?: boolean;
}

export interface Boat {
  type: string;
  sailingSince?: number;
}

/** Anything we may find in storage or an imported file (v1 bred in place via breedingUntil). */
type LegacySave = Omit<Partial<SaveState>, 'version' | 'objects'> & {
  version: number;
  breedingSlots?: number;
  objects: (ZooObject & { breedingUntil?: number })[];
};

export interface SaveState {
  version: 2;
  coins: number;
  gold: number;
  xp: number;
  mapIndex: number;
  objects: ZooObject[];
  nextId: number;
  landBuildUntil: number;
  lastTrash: number;
  dailyStreak: number;
  dailyLast: string;
  music: boolean;
  /** Purchased nursery slots; nests[i] is slot i (null = empty). */
  breedSlots: number;
  nests: (Nest | null)[];
  crossSlots: number;
  crossNests: (CrossNest | null)[];
  /** Hybrids already discovered (shown instead of "?"). */
  discovered: string[];
  inventory: Record<string, number>;
  unlocked: string[];
  exclaimFamilies: string[];
  achDone: string[];
  achStarted: Record<string, number>;
  achBaseline: Record<string, Record<string, number>>;
  stats: Record<string, number>;
  tutorialKeys: string[];
  loginDays: string[];
  ticketPrice: number;
  revenueSince: number;
  bonus: { progress: number; payouts: number; day: string };
  boats: Boat[];
  neighborDay: string;
  neighborHelped: number[];
  /** When the game last ran, for the "while you were away" summary. */
  lastSeen: number;
}

const SAVE_KEY = 'tapzoo-save-v1';
const MIN = 60_000;
const HOUR = 3_600_000;
const TRASH_EVERY = 4 * MIN;
const TRASH_MAX = 8;
/** One zoo day of ticket sales (design choice; the original's length is not in the data). */
export const ZOO_DAY = HOUR;
const BONUS_PAYOUTS_PER_DAY = 5;

export type GameEvent =
  | { kind: 'coins'; amount: number; gold?: boolean; x: number; y: number }
  | { kind: 'xp'; amount: number; x: number; y: number }
  | { kind: 'levelup'; level: number; coins: number; gold: number }
  | { kind: 'toast'; text: string }
  | { kind: 'bonus'; coins: number }
  | { kind: 'notify'; state: 'ready' | 'sick'; name: string; cross: boolean }
  | { kind: 'placeFromInventory'; type: string }
  | { kind: 'changed' };

type Listener = (e: GameEvent) => void;

const today = () => new Date().toDateString();

export class Game {
  s: SaveState;
  private listeners: Listener[] = [];
  private occupancy = new Map<string, ZooObject>();

  /** `persist: false` makes a read-only world, used for visiting the neighbor's zoo. */
  constructor(initial?: SaveState, readonly persist = true) {
    this.s = initial ?? this.load() ?? this.fresh();
    this.reindex();
    if (!this.s.loginDays.includes(today())) this.s.loginDays.push(today());
  }

  on(fn: Listener): void {
    this.listeners.push(fn);
  }

  emit(e: GameEvent): void {
    for (const l of this.listeners) l(e);
  }

  // ---------- persistence ----------

  fresh(): SaveState {
    // Starting values from the bundled gameState.db and NewGameObjects.csv.
    const now = Date.now();
    const s: SaveState = {
      version: 2,
      coins: 300,
      gold: 1,
      xp: 0,
      mapIndex: 0,
      objects: [],
      nextId: 1,
      landBuildUntil: 0,
      lastTrash: now,
      dailyStreak: 0,
      dailyLast: '',
      music: true,
      breedSlots: 0,
      nests: [],
      crossSlots: 0,
      crossNests: [],
      discovered: [],
      inventory: {},
      unlocked: [],
      exclaimFamilies: [],
      achDone: [],
      achStarted: {},
      achBaseline: {},
      stats: {},
      tutorialKeys: [],
      loginDays: [today()],
      ticketPrice: 1,
      revenueSince: now,
      bonus: { progress: 0, payouts: 0, day: today() },
      boats: [],
      neighborDay: '',
      neighborHelped: [],
      lastSeen: now,
    };
    const add = (type: string, x: number, y: number) => s.objects.push({ id: s.nextId++, type, x, y, flip: false });
    add('FrontGateEast', 3, 1);
    add('FrontGateWest', 3, 3);
    for (const [x, y] of [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]]) add('Sidewalk', x, y);
    return s;
  }

  private load(): SaveState | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? this.migrate(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  /** Accepts v1 saves and anything with missing fields, filling in defaults. */
  migrate(raw: LegacySave): SaveState {
    const s = { ...this.fresh(), ...(raw as Partial<SaveState>), version: 2 } as SaveState;
    if (raw.version === 1) {
      s.breedSlots = raw.breedingSlots ?? 0;
      s.nests = [];
      s.objects = raw.objects.map(({ breedingUntil, ...o }) => {
        // v1 bred in place; finish any pending babies.
        if (breedingUntil) o.count = Math.min(items.get(o.type)?.maxCount ?? 4, (o.count ?? 1) + 1);
        return o;
      });
    }
    s.objects = s.objects.filter((o) => items.has(o.type));
    s.achDone = [...new Set(s.achDone)];
    Game.mergeHabitats(s);
    return s;
  }

  /** Older saves allowed several habitats per species; fold them into one. */
  private static mergeHabitats(s: SaveState): void {
    const first = new Map<string, ZooObject>();
    s.objects = s.objects.filter((o) => {
      const t = items.get(o.type)!;
      if (t.category !== 'animal') return true;
      const keep = first.get(o.type);
      if (!keep) {
        first.set(o.type, o);
        return true;
      }
      keep.count = Math.min(t.maxCount, (keep.count ?? 1) + (o.count ?? 1));
      return false;
    });
  }

  save(): void {
    if (!this.persist) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.s));
    } catch {
      // Storage unavailable; the session still plays.
    }
  }

  exportSave(): string {
    return JSON.stringify(this.s);
  }

  importSave(json: string): boolean {
    try {
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.objects)) return false;
      this.s = this.migrate(parsed);
      this.landCache = null;
      this.reindex();
      this.save();
      this.emit({ kind: 'changed' });
      return true;
    } catch {
      return false;
    }
  }

  reset(): void {
    this.s = this.fresh();
    this.landCache = null;
    this.reindex();
    this.save();
    this.emit({ kind: 'changed' });
  }

  // ---------- stats (feed the achievement engine) ----------

  stat(key: string): number {
    return this.s.stats[key] ?? 0;
  }

  bump(key: string, by = 1): void {
    this.s.stats[key] = this.stat(key) + by;
  }

  tutorialKey(key: string): void {
    if (!this.s.tutorialKeys.includes(key)) this.s.tutorialKeys.push(key);
  }

  // ---------- map & occupancy ----------

  get map(): MapDef {
    return maps[Math.min(this.s.mapIndex, maps.length - 1)];
  }

  get level(): number {
    return levelForXp(this.s.xp);
  }

  private landCache: { idx: number; set: Set<string> } | null = null;

  /** Tiles of the current map where things can be built. */
  land(): Set<string> {
    if (this.landCache?.idx !== this.s.mapIndex) {
      const m = this.map;
      const set = new Set<string>();
      for (const [i, j] of m.place) set.add(`${i},${j}`);
      for (const [i, j] of m.walk) set.add(`${i},${j}`);
      this.landCache = { idx: this.s.mapIndex, set };
    }
    return this.landCache.set;
  }

  reindex(): void {
    this.occupancy.clear();
    for (const o of this.s.objects) {
      const t = items.get(o.type)!;
      if (t.category === 'staff') continue;
      const [w, h] = this.dims(o, t);
      for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) this.occupancy.set(`${o.x + i},${o.y + j}`, o);
    }
  }

  dims(o: { flip: boolean }, t: ItemType): [number, number] {
    return o.flip ? [t.h, t.w] : [t.w, t.h];
  }

  objectAt(i: number, j: number): ZooObject | undefined {
    return this.occupancy.get(`${i},${j}`);
  }

  byId(id: number): ZooObject | undefined {
    return this.s.objects.find((o) => o.id === id);
  }

  canPlace(t: ItemType, x: number, y: number, flip: boolean, ignore?: ZooObject): boolean {
    const [w, h] = flip ? [t.h, t.w] : [t.w, t.h];
    const land = this.land();
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) {
        const k = `${x + i},${y + j}`;
        if (!land.has(k)) return false;
        const o = this.occupancy.get(k);
        if (o && o !== ignore) return false;
      }
    }
    return true;
  }

  /** Smart path variant for a tile, e.g. "Sidewalk_5", based on same-family neighbours. */
  smartVariant(o: ZooObject): ItemType {
    const t = items.get(o.type)!;
    if (!t.smartFamily) return t;
    let mask = 0;
    for (const d of DIRS) {
      const n = this.objectAt(o.x + d.di, o.y + d.dj);
      if (n && items.get(n.type)?.smartFamily === t.smartFamily) mask |= d.bit;
    }
    return items.get(`${t.smartFamily}${mask}`) ?? t;
  }

  isPath(i: number, j: number): boolean {
    const o = this.objectAt(i, j);
    if (!o) return false;
    const t = items.get(o.type)!;
    return t.category === 'path' && !/Shrub|River|Stream/.test(t.smartFamily ?? t.rowType);
  }

  // ---------- economy ----------

  /** How many of a type (or class like "MammalCage"/"AnimalCage") the player has, incl. inventory. */
  owned(nameOrClass: string): number {
    let n = 0;
    for (const o of this.s.objects) {
      const t = items.get(o.type)!;
      const match = o.type === nameOrClass || t.rowType === nameOrClass || (nameOrClass === 'AnimalCage' && t.category === 'animal');
      if (match) n += t.category === 'animal' ? (o.count ?? 1) : 1;
    }
    for (const [type, c] of Object.entries(this.s.inventory)) {
      const t = items.get(type);
      if (t && (type === nameOrClass || t.rowType === nameOrClass || (nameOrClass === 'AnimalCage' && t.category === 'animal'))) n += c;
    }
    return n;
  }

  species(cls: string): number {
    return this.s.objects.filter((o) => {
      const t = items.get(o.type)!;
      return t.category === 'animal' && (cls === 'AnimalCage' || t.rowType === cls);
    }).length;
  }

  countOwned(type: string): number {
    return this.s.objects.filter((o) => o.type === type).length;
  }

  canAfford(amount: number, gold: boolean): boolean {
    return gold ? this.s.gold >= amount : this.s.coins >= amount;
  }

  pay(amount: number, gold: boolean): boolean {
    if (!this.canAfford(amount, gold)) {
      this.emit({ kind: 'toast', text: gold ? 'Not enough stars!' : 'Not enough coins!' });
      return false;
    }
    if (gold) this.s.gold -= amount;
    else this.s.coins -= amount;
    return true;
  }

  addCoins(amount: number, x = 0, y = 0): void {
    this.s.coins += amount;
    if (amount) this.emit({ kind: 'coins', amount, x, y });
  }

  addXp(amount: number, x = 0, y = 0): void {
    if (amount <= 0) return;
    const before = this.level;
    this.s.xp += amount;
    this.emit({ kind: 'xp', amount, x, y });
    const after = this.level;
    for (let lv = before + 1; lv <= after; lv++) {
      const l = levels.find((q) => q.level === lv);
      if (!l) continue;
      this.s.coins += l.coins;
      this.s.gold += l.gold;
      this.emit({ kind: 'levelup', level: lv, coins: l.coins, gold: l.gold });
    }
  }

  isAvailable(t: ItemType): boolean {
    return t.purchaseable && (!t.locked || this.s.unlocked.includes(t.name));
  }

  /** Each species lives in a single habitat. */
  habitatOf(type: string): ZooObject | undefined {
    return items.get(type)?.category === 'animal' ? this.s.objects.find((o) => o.type === type) : undefined;
  }

  buyCheck(t: ItemType): string | null {
    if (t.level > this.level) return `Unlocks at level ${t.level}`;
    if (t.category === 'animal') {
      // maxToPurchase is how many you can buy (a pair); the rest come from breeding.
      const h = this.habitatOf(t.name);
      if (h && (h.count ?? 1) >= t.maxOwned) return `You have a pair of ${t.display}s — breed them for more`;
      // The original required enough rangers before buying more animals.
      const g = gradeReport(this);
      const rangers = this.countOfCategory('staff');
      if (!h && this.species('AnimalCage') >= 6 && rangers < Math.floor(g.rangersNeeded / 2)) return 'Hire more rangers to look after more animals';
    } else if (t.maxOwned > 0 && this.countOwned(t.name) >= t.maxOwned) return `You can own ${t.maxOwned}`;
    if (!this.canAfford(t.price, t.gold)) return t.gold ? 'Not enough stars' : 'Not enough coins';
    return null;
  }

  countOfCategory(cat: string): number {
    return this.s.objects.filter((o) => items.get(o.type)!.category === cat).length;
  }

  /** Places a new object; `free` skips payment (inventory items and achievement gifts). */
  place(t: ItemType, x: number, y: number, flip: boolean, free = false): ZooObject | null {
    if (!this.canPlace(t, x, y, flip) || this.habitatOf(t.name)) return null;
    if (!free) {
      const why = this.buyCheck(t);
      if (why) {
        this.emit({ kind: 'toast', text: why });
        return null;
      }
      if (!this.pay(t.price, t.gold)) return null;
    }
    const o: ZooObject = { id: this.s.nextId++, type: t.name, x, y, flip };
    if (t.category === 'animal') o.count = 1;
    if (t.growMinutes > 0) o.cycleStart = Date.now();
    this.s.objects.push(o);
    this.reindex();
    if (!free) this.addXp(t.xpBuy, x, y);
    if (t.category === 'animal') this.tutorialKey(free ? 'placeAnimal' : 'buyAnimal');
    this.save();
    this.emit({ kind: 'changed' });
    return o;
  }

  placeFromInventory(t: ItemType, x: number, y: number, flip: boolean): ZooObject | null {
    if (!this.s.inventory[t.name]) return null;
    const o = this.place(t, x, y, flip, true);
    if (o) this.takeFromInventory(t.name);
    return o;
  }

  addToInventory(type: string, n = 1): void {
    const h = this.habitatOf(type);
    const t = items.get(type);
    // A hybrid joins its existing habitat if there's room in the pair.
    if (h && t && (h.count ?? 1) < t.maxOwned) {
      h.count = (h.count ?? 1) + 1;
      return;
    }
    this.s.inventory[type] = (this.s.inventory[type] ?? 0) + n;
  }

  private takeFromInventory(type: string): void {
    const left = (this.s.inventory[type] ?? 0) - 1;
    if (left > 0) this.s.inventory[type] = left;
    else delete this.s.inventory[type];
    this.save();
    this.emit({ kind: 'changed' });
  }

  /** Buys another animal into the species' existing habitat (e.g. the second of a pair). */
  addAnimal(t: ItemType): boolean {
    const h = this.habitatOf(t.name);
    const why = h ? this.buyCheck(t) : 'Buy a habitat first';
    if (why) {
      this.emit({ kind: 'toast', text: why });
      return false;
    }
    if (!h || !this.pay(t.price, t.gold)) return false;
    h.count = (h.count ?? 1) + 1;
    this.addXp(t.xpBuy, h.x, h.y);
    this.tutorialKey('buyAdditionalAnimal');
    this.emit({ kind: 'toast', text: `Your ${t.display}s are a pair now — they can breed!` });
    this.save();
    this.emit({ kind: 'changed' });
    return true;
  }

  move(o: ZooObject, x: number, y: number, flip: boolean): boolean {
    const t = items.get(o.type)!;
    if (!this.canPlace(t, x, y, flip, o)) return false;
    o.x = x;
    o.y = y;
    o.flip = flip;
    this.reindex();
    this.save();
    this.emit({ kind: 'changed' });
    return true;
  }

  sell(o: ZooObject): void {
    const t = items.get(o.type)!;
    this.s.nests = this.s.nests.map((n) => (n?.cageId === o.id ? null : n));
    this.s.objects = this.s.objects.filter((q) => q !== o);
    // Sell prices are always paid in coins (star items list a token 1-coin price).
    this.s.coins += t.sellPrice * (o.count ?? 1);
    this.reindex();
    this.save();
    this.emit({ kind: 'changed' });
  }

  // ---------- production ----------

  cycleMs(t: ItemType): number {
    return Math.max(1, t.growMinutes) * MIN;
  }

  readyAt(o: ZooObject): number {
    const t = items.get(o.type)!;
    return (o.cycleStart ?? Date.now()) + this.cycleMs(t);
  }

  isReady(o: ZooObject, now = Date.now()): boolean {
    const t = items.get(o.type)!;
    return t.growMinutes > 0 && t.harvestCoins > 0 && now >= this.readyAt(o) && !this.isSick(o, now);
  }

  harvest(o: ZooObject, x = o.x, y = o.y): boolean {
    if (!this.isReady(o)) return false;
    const t = items.get(o.type)!;
    const coins = t.harvestCoins * (o.count ?? 1);
    o.cycleStart = Date.now();
    this.addCoins(coins, x, y);
    this.addXp(t.harvestXp * (o.count ?? 1), x, y);
    this.tutorialKey('collectMoney');
    this.bump(`collect:${t.name}`);
    this.advanceBonus();
    this.save();
    this.emit({ kind: 'changed' });
    return true;
  }

  /** Everything ready to collect right now (GameState harvestEverything). */
  readyObjects(now = Date.now()): ZooObject[] {
    return this.s.objects.filter((o) => this.isReady(o, now));
  }

  /** Collects every ready habitat, tree and shop plus the gate's ticket money. */
  collectAll(): { count: number; coins: number } {
    const before = this.s.coins;
    const ready = this.readyObjects();
    for (const o of ready) this.harvest(o);
    const gate = this.collectRevenue() ? 1 : 0;
    return { count: ready.length + gate, coins: this.s.coins - before };
  }

  // ---------- bonus bar (StatusPanel bonusBar*) ----------

  bonusTarget(): number {
    return 8 + this.level * 2;
  }

  bonusPayout(): number {
    return 100 * this.level + 50;
  }

  private advanceBonus(): void {
    const b = this.s.bonus;
    if (b.day !== today()) Object.assign(b, { progress: 0, payouts: 0, day: today() });
    if (b.payouts >= BONUS_PAYOUTS_PER_DAY) return;
    b.progress++;
    if (b.progress >= this.bonusTarget()) {
      b.progress = 0;
      b.payouts++;
      const coins = this.bonusPayout();
      this.s.coins += coins;
      this.emit({ kind: 'bonus', coins });
    }
  }

  bonusMaxed(): boolean {
    return this.s.bonus.day === today() && this.s.bonus.payouts >= BONUS_PAYOUTS_PER_DAY;
  }

  // ---------- nursery (BreedingInventory) ----------

  nestFor(o: ZooObject): Nest | undefined {
    return this.s.nests.find((n) => n?.cageId === o.id) ?? undefined;
  }

  nextSlotCost(): { cost: number; gold: boolean } | null {
    return breedingSlotCosts[this.s.breedSlots] ?? null;
  }

  buySlot(): boolean {
    const c = this.nextSlotCost();
    if (!c || !this.pay(c.cost, c.gold)) return false;
    this.s.breedSlots++;
    this.save();
    this.emit({ kind: 'changed' });
    return true;
  }

  freeSlot(): number {
    for (let i = 0; i < this.s.breedSlots; i++) if (!this.s.nests[i]) return i;
    return -1;
  }

  breedCheck(o: ZooObject): string | null {
    const t = items.get(o.type)!;
    if (!t.breedable) return 'This animal cannot breed';
    if (this.nestFor(o)) return 'Already breeding';
    if ((o.count ?? 1) < 2) return `Breeding needs a pair — buy a second ${t.display}`;
    if ((o.count ?? 1) >= t.maxCount) return `Habitat is full (${t.maxCount})`;
    if (this.freeSlot() < 0) return this.s.breedSlots ? 'No free nest in the Nursery' : 'Buy a nest in the Nursery first';
    if (!this.canAfford(t.breedCost, t.breedGold)) return t.breedGold ? 'Not enough stars' : 'Not enough coins';
    return null;
  }

  /** Animals that could start breeding now (BreedableAnimalsTableViewController). */
  breedable(): ZooObject[] {
    return this.s.objects.filter((o) => {
      const t = items.get(o.type)!;
      return t.category === 'animal' && t.breedable && !this.nestFor(o) && (o.count ?? 1) >= 2 && (o.count ?? 1) < t.maxCount;
    });
  }

  breed(o: ZooObject, slot = this.freeSlot()): boolean {
    const why = this.breedCheck(o) ?? (slot < 0 || slot >= this.s.breedSlots || this.s.nests[slot] ? 'That nest is not free' : null);
    if (why) {
      this.emit({ kind: 'toast', text: why });
      return false;
    }
    const t = items.get(o.type)!;
    if (!this.pay(t.breedCost, t.breedGold)) return false;
    const now = Date.now();
    this.s.nests[slot] = { cageId: o.id, start: now, end: now + t.breedMs };
    this.bump('DidStartBreeding');
    this.tutorialKey('breeding');
    this.save();
    this.emit({ kind: 'changed' });
    return true;
  }

  /** Stars to finish now, prorated by time left (BreedingSlotView getRemainingCost:). */
  expediteCost(full: number, start: number, end: number): number {
    const left = Math.max(0, end - Date.now());
    return Math.max(1, Math.ceil((full * left) / Math.max(1, end - start)));
  }

  private eggState(n: { end: number; revived?: boolean }, t: ItemType, now: number): 'incubating' | 'ready' | 'sick' {
    if (now < n.end) return 'incubating';
    if (!n.revived && t.marginHours >= 0 && now > n.end + t.marginHours * HOUR) return 'sick';
    return 'ready';
  }

  nestState(n: Nest, now = Date.now()): 'incubating' | 'ready' | 'sick' {
    const cage = this.byId(n.cageId);
    return cage ? this.eggState(n, items.get(cage.type)!, now) : 'ready';
  }

  /** A habitat whose finished egg was left too long shows as sick on the map. */
  isSick(o: ZooObject, now = Date.now()): boolean {
    const n = this.nestFor(o);
    return !!n && this.nestState(n, now) === 'sick';
  }

  expediteNest(slot: number): boolean {
    const n = this.s.nests[slot];
    const cage = n && this.byId(n.cageId);
    if (!n || !cage) return false;
    const t = items.get(cage.type)!;
    if (!this.pay(this.expediteCost(t.expediteGold, n.start, n.end), true)) return false;
    n.end = Date.now();
    return this.completeNest(slot);
  }

  reviveNest(slot: number): boolean {
    const n = this.s.nests[slot];
    const cage = n && this.byId(n.cageId);
    if (!n || !cage) return false;
    const t = items.get(cage.type)!;
    if (!this.pay(t.reviveCost, true)) return false;
    n.revived = true;
    this.bump(`saveSick:${t.rowType}`);
    return this.completeNest(slot);
  }

  /** "Tap to complete": the baby joins its habitat. */
  completeNest(slot: number): boolean {
    const n = this.s.nests[slot];
    const cage = n && this.byId(n.cageId);
    if (!n) return false;
    if (!cage) {
      this.s.nests[slot] = null;
      return false;
    }
    if (this.nestState(n) !== 'ready') return false;
    const t = items.get(cage.type)!;
    this.s.nests[slot] = null;
    cage.count = Math.min(t.maxCount, (cage.count ?? 1) + 1);
    this.bump(`bred:${t.name}`);
    this.bump(`bred:${t.rowType}`);
    this.bump('breedAny');
    this.addXp(t.harvestXp, cage.x, cage.y);
    this.emit({ kind: 'toast', text: `A baby ${t.display} joined the habitat!` });
    this.save();
    this.emit({ kind: 'changed' });
    return true;
  }

  discardNest(slot: number): void {
    this.s.nests[slot] = null;
    this.save();
    this.emit({ kind: 'changed' });
  }

  // ---------- crossbreeding (CrossBreedingInventory) ----------

  nextCrossSlotCost(): { cost: number; gold: boolean } | null {
    return crossSlotCosts[this.s.crossSlots] ?? null;
  }

  buyCrossSlot(): boolean {
    const c = this.nextCrossSlotCost();
    if (!c || !this.pay(c.cost, c.gold)) return false;
    this.s.crossSlots++;
    this.save();
    this.emit({ kind: 'changed' });
    return true;
  }

  crossCheck(a: string, b: string, slot: number): string | null {
    const r = recipeFor(a, b);
    if (!r) return "Those two can't be crossbred";
    if (slot >= this.s.crossSlots) return 'Unlock this crossbreeding slot first';
    if (this.s.crossNests[slot]) return 'This slot is busy';
    if (!this.habitatOf(a) || !this.habitatOf(b)) return 'You need both parent animals in your zoo';
    const t = items.get(r.result)!;
    if (!this.canAfford(t.breedCost, t.breedGold)) return t.breedGold ? 'Not enough stars' : 'Not enough coins';
    return null;
  }

  crossbreed(a: string, b: string, slot: number): boolean {
    const why = this.crossCheck(a, b, slot);
    if (why) {
      this.emit({ kind: 'toast', text: why });
      return false;
    }
    const r = recipeFor(a, b)!;
    const t = items.get(r.result)!;
    if (!this.pay(t.breedCost, t.breedGold)) return false;
    const now = Date.now();
    this.s.crossNests[slot] = { result: r.result, a, b, start: now, end: now + t.breedMs };
    this.bump('DidStartBreeding');
    this.save();
    this.emit({ kind: 'changed' });
    return true;
  }

  crossState(n: CrossNest, now = Date.now()): 'incubating' | 'ready' | 'sick' {
    return this.eggState(n, items.get(n.result)!, now);
  }

  expediteCross(slot: number): boolean {
    const n = this.s.crossNests[slot];
    if (!n) return false;
    const t = items.get(n.result)!;
    if (!this.pay(this.expediteCost(t.expediteGold, n.start, n.end), true)) return false;
    n.end = Date.now();
    return this.completeCross(slot);
  }

  reviveCross(slot: number): boolean {
    const n = this.s.crossNests[slot];
    if (!n) return false;
    const t = items.get(n.result)!;
    if (!this.pay(t.reviveCost, true)) return false;
    n.revived = true;
    this.bump(`saveSick:${t.rowType}`);
    return this.completeCross(slot);
  }

  completeCross(slot: number): boolean {
    const n = this.s.crossNests[slot];
    if (!n || this.crossState(n) !== 'ready') return false;
    const t = items.get(n.result)!;
    this.s.crossNests[slot] = null;
    if (!this.s.discovered.includes(t.name)) this.s.discovered.push(t.name);
    this.addToInventory(t.name);
    this.bump(`cross:${t.name}`);
    this.bump(`cross:${t.rowType}`);
    this.bump('crossAny');
    this.addXp(t.xpBuy || t.harvestXp);
    this.emit({ kind: 'toast', text: `You crossbred a ${t.display}!` });
    if (this.s.inventory[t.name]) this.emit({ kind: 'placeFromInventory', type: t.name });
    this.save();
    this.emit({ kind: 'changed' });
    return true;
  }

  discardCross(slot: number): void {
    this.s.crossNests[slot] = null;
    this.save();
    this.emit({ kind: 'changed' });
  }

  // ---------- tickets & visitors (TicketPricePanel, visitorsPerDay) ----------

  /** Ticket price visitors consider fair; grows with level (design choice). */
  fairPrice(): number {
    return 2 + Math.floor(this.level / 2);
  }

  visitorsPerDay(): number {
    const g = gradeReport(this).grades.Overall;
    const animals = this.owned('AnimalCage');
    const base = 40 + animals * 12 + this.species('AnimalCage') * 20 + this.level * 15;
    const ratio = this.s.ticketPrice / this.fairPrice();
    const priceFactor = Math.max(0.05, 1.25 - 0.25 * ratio * ratio);
    return Math.round(base * (0.5 + g / 10) * priceFactor);
  }

  pendingRevenue(now = Date.now()): number {
    const elapsed = Math.min(ZOO_DAY, Math.max(0, now - this.s.revenueSince));
    return Math.floor((elapsed / ZOO_DAY) * this.visitorsPerDay() * this.s.ticketPrice);
  }

  collectRevenue(x = 3, y = 2): boolean {
    const coins = this.pendingRevenue();
    if (coins <= 0) return false;
    this.s.revenueSince = Date.now();
    this.addCoins(coins, x, y);
    this.addXp(Math.max(1, Math.floor(coins / 100)), x, y);
    this.bump('DidCollectRevenue');
    this.save();
    this.emit({ kind: 'changed' });
    return true;
  }

  setTicketPrice(p: number): void {
    // Lock in what was earned at the old price first.
    const pending = this.pendingRevenue();
    if (pending > 0) this.collectRevenue();
    this.s.ticketPrice = Math.max(1, Math.min(99, Math.round(p)));
    this.save();
    this.emit({ kind: 'changed' });
  }

  // ---------- sidegrades (SidegradesPanel) ----------

  familyOf(t: ItemType): string | undefined {
    if (t.family) return t.family;
    for (const [fam, base] of familyBase) if (base === t.name) return fam;
    return undefined;
  }

  /** Unlocked variants an object could be swapped into. */
  sidegrades(o: ZooObject): ItemType[] {
    const fam = this.familyOf(items.get(o.type)!);
    if (!fam) return [];
    const base = familyBase.get(fam);
    return [...items.values()].filter(
      (t) => t.name !== o.type && (t.family === fam || t.name === base) && (!t.locked || this.s.unlocked.includes(t.name)),
    );
  }

  sidegrade(o: ZooObject, to: ItemType): boolean {
    if (!this.canPlace(to, o.x, o.y, o.flip, o)) {
      this.emit({ kind: 'toast', text: "It doesn't fit here — move it somewhere roomier first" });
      return false;
    }
    if (!this.pay(to.price, to.gold)) return false;
    o.type = to.name;
    const fam = this.familyOf(to);
    this.s.exclaimFamilies = this.s.exclaimFamilies.filter((f) => f !== fam);
    this.reindex();
    this.save();
    this.emit({ kind: 'changed' });
    return true;
  }

  hasExclamation(o: ZooObject): boolean {
    const fam = this.familyOf(items.get(o.type)!);
    return !!fam && this.s.exclaimFamilies.includes(fam);
  }

  // ---------- land ----------

  nextMap(): MapDef | null {
    return maps[this.s.mapIndex + 1] ?? null;
  }

  buyLand(): boolean {
    const m = this.nextMap();
    if (!m || this.s.landBuildUntil) return false;
    if (!this.pay(m.cost, false)) return false;
    this.s.landBuildUntil = Date.now() + m.buildMinutes * MIN;
    this.save();
    this.tick();
    this.emit({ kind: 'changed' });
    return true;
  }

  expediteLand(): boolean {
    const m = this.nextMap();
    if (!m || !this.s.landBuildUntil) return false;
    const full = m.expediteGold;
    const cost = this.expediteCost(full, this.s.landBuildUntil - m.buildMinutes * MIN, this.s.landBuildUntil);
    if (!this.pay(cost, true)) return false;
    this.s.landBuildUntil = Date.now();
    this.tick();
    return true;
  }

  // ---------- trash ----------

  trashMax(): number {
    // Trash cans keep the zoo cleaner.
    const cans = this.s.objects.filter((o) => /Trash Can|Recycle Bin/.test(o.type)).length;
    return Math.max(2, TRASH_MAX - cans);
  }

  spawnTrash(): void {
    const trashTypes = [...items.values()].filter((t) => t.rowType === 'Trash' && !t.missingArt);
    const existing = this.s.objects.filter((o) => items.get(o.type)!.rowType === 'Trash').length;
    if (!trashTypes.length || existing >= this.trashMax()) return;
    const free = [...this.land()].filter((k) => !this.occupancy.has(k));
    if (!free.length) return;
    const [x, y] = free[Math.floor(Math.random() * free.length)].split(',').map(Number);
    const t = trashTypes[Math.floor(Math.random() * trashTypes.length)];
    this.s.objects.push({ id: this.s.nextId++, type: t.name, x, y, flip: Math.random() < 0.5 });
    this.reindex();
  }

  cleanTrash(o: ZooObject, x: number, y: number): void {
    if (!this.s.objects.includes(o)) return;
    this.s.objects = this.s.objects.filter((q) => q !== o);
    this.reindex();
    this.addCoins(5, x, y);
    this.addXp(1, x, y);
    this.bump('trash');
    this.tutorialKey('trash');
    this.advanceBonus();
    this.save();
    this.emit({ kind: 'changed' });
  }

  // ---------- boats ----------

  dock(): ZooObject | undefined {
    return this.s.objects.find((o) => o.type === 'Dock');
  }

  // ---------- daily bonus ----------

  dailyAvailable(): { day: number; coins: number } | null {
    if (this.s.dailyLast === today()) return null;
    const yesterday = new Date(Date.now() - 86_400_000).toDateString();
    const day = this.s.dailyLast === yesterday ? Math.min(5, this.s.dailyStreak + 1) : 1;
    const row = dailyBonus.find((r) => Number(r.level) === Math.min(this.level, dailyBonus.length)) ?? dailyBonus[0];
    return { day, coins: Number(row?.[`day${day}`] ?? 600) };
  }

  claimDaily(): void {
    const d = this.dailyAvailable();
    if (!d) return;
    this.s.dailyLast = today();
    this.s.dailyStreak = d.day;
    this.s.coins += d.coins;
    this.save();
    this.emit({ kind: 'changed' });
  }

  // ---------- rangers ----------

  /** Rangers don't take up space: hiring adds them to the zoo straight away. */
  hire(t: ItemType): boolean {
    const why = this.buyCheck(t);
    if (why) {
      this.emit({ kind: 'toast', text: why });
      return false;
    }
    if (!this.pay(t.price, t.gold)) return false;
    this.s.objects.push({ id: this.s.nextId++, type: t.name, x: 1, y: 2, flip: false });
    this.addXp(t.xpBuy);
    this.emit({ kind: 'toast', text: `${t.display} joined your zoo and will collect coins for you` });
    this.save();
    this.emit({ kind: 'changed' });
    return true;
  }

  private keeperClock = 0;

  /** Each ranger collects one ready habitat roughly every 20 seconds. */
  private keepersWork(now: number): void {
    const keepers = this.countOfCategory('staff');
    if (!keepers) return;
    if (!this.keeperClock) this.keeperClock = now;
    if (now - this.keeperClock < 20_000 / keepers) return;
    this.keeperClock = now;
    const ready = this.s.objects.filter((o) => items.get(o.type)!.category === 'animal' && this.isReady(o, now));
    if (ready.length) this.harvest(ready[Math.floor(Math.random() * ready.length)]);
  }

  // ---------- clock ----------

  private notified = new Map<string, string>();

  /** Advances timers; safe to call often. */
  tick(): void {
    const now = Date.now();
    let changed = false;
    if (this.s.landBuildUntil && now >= this.s.landBuildUntil) {
      this.s.landBuildUntil = 0;
      this.s.mapIndex++;
      this.landCache = null;
      this.emit({ kind: 'toast', text: 'Your new land is ready!' });
      changed = true;
    }
    while (now - this.s.lastTrash > TRASH_EVERY) {
      this.s.lastTrash += TRASH_EVERY;
      this.spawnTrash();
      changed = true;
    }
    // Hatch and sick notifications (LocalNotifications.csv "Breeding-finished"), once per change.
    const announce = (key: string, state: 'incubating' | 'ready' | 'sick', name: string, cross: boolean) => {
      if (state === 'incubating' || this.notified.get(key) === state) return;
      this.notified.set(key, state);
      this.emit({ kind: 'notify', state, name, cross });
    };
    this.s.nests.forEach((n, i) => {
      const cage = n && this.byId(n.cageId);
      if (n && cage) announce(`n${i}:${n.start}`, this.nestState(n, now), items.get(cage.type)!.display, false);
    });
    this.s.crossNests.forEach((n, i) => {
      if (!n) return;
      const known = this.s.discovered.includes(n.result);
      announce(`c${i}:${n.start}`, this.crossState(n, now), known ? items.get(n.result)!.display : 'mystery animal', true);
    });
    if (now - this.s.lastSeen > 30_000) {
      this.s.lastSeen = now;
      changed = true;
    }
    if (!this.s.loginDays.includes(today())) {
      this.s.loginDays.push(today());
      changed = true;
    }
    this.keepersWork(now);
    if (changed) {
      this.save();
      this.emit({ kind: 'changed' });
    }
  }
}
