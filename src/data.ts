// Builds the game catalog and rule tables from the original CSVs (converted to JSON by the
// extractor). Every item is included; those whose art was streamed from Pocket Gems' servers
// render as placeholders (or custom art from public/custom-art/).
import { expansionAnimals, expansionHybrids } from './content/expansion';
import { animFrames, fetchJson, hasImage, loadCustomArt, loadCustomArtIndex, placeholderSprite, resolveSprite, spriteDataUrl } from './assets';

type Row = Record<string, string | number | undefined>;

export type Category = 'animal' | 'building' | 'tree' | 'decoration' | 'path' | 'staff' | 'internal';

export interface ItemType {
  name: string;
  display: string;
  rowType: string;
  category: Category;
  level: number;
  price: number;
  gold: boolean;
  sellPrice: number;
  xpBuy: number;
  w: number;
  h: number;
  sprite: string | null;
  frames: string[];
  frameMs: number;
  xflip: boolean;
  thumb: string;
  /** True when the art was not bundled and `sprite` is a placeholder. */
  missingArt: boolean;
  // Production (animals, trees, shops).
  growMinutes: number;
  harvestCoins: number;
  harvestXp: number;
  // Breeding.
  breedable: boolean;
  breedCost: number;
  breedGold: boolean;
  /** Breeding/crossbreeding time in ms (feedingTimes x feedingTimesUnit). */
  breedMs: number;
  /** Hours a finished egg can wait before the baby gets sick; -1 = never. */
  marginHours: number;
  reviveCost: number;
  expediteGold: number;
  maxCount: number;
  maxOwned: number;
  value: number;
  quality: number;
  purchaseable: boolean;
  /** Needs an `unlock:` achievement reward before it shows in the store. */
  locked: boolean;
  /** Sidegrade family, e.g. "iceCream". */
  family?: string;
  smartFamily?: string;
  walkBase?: string;
  tipText?: string;
}

export interface MapDef {
  id: string;
  w: number;
  h: number;
  cost: number;
  buildMinutes: number;
  expediteGold: number;
  signs: [number, number][];
  pieces: { sprite: string | null; flip: boolean; x: number; y: number }[];
  walk: [number, number][];
  place: [number, number][];
}

export interface Level {
  level: number;
  xp: number;
  coins: number;
  gold: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  requirements: string[];
  prerequisites: string[];
  rewards: string[];
  priority: number;
  invisible: boolean;
  autocomplete: boolean;
  suppressMessage: boolean;
  fallThrough?: string;
  icon: string;
  completedIcon: string;
  completionTitle?: string;
  completionText?: string;
  completionImage?: string;
  initTitle?: string;
  initText?: string;
  initImage?: string;
}

export interface CrossRecipe {
  result: string;
  a: string;
  b: string;
}

export interface GradeRow {
  level: number;
  animals: number;
  parking: number;
  trashCans: number;
  shops: number;
  food: number;
  facilities: number;
}

export interface BoatType {
  name: string;
  dockedX: number;
  dockedY: number;
  speed: number;
}

export interface Neighbor {
  name: string;
  xp: number;
  mapIndex: number;
  objects: { name: string; x: number; y: number; count: number }[];
}

export const items = new Map<string, ItemType>();
export const maps: MapDef[] = [];
export let levels: Level[] = [];
export let dailyBonus: Row[] = [];
export let breedingSlotCosts: { cost: number; gold: boolean }[] = [];
export let crossSlotCosts: { cost: number; gold: boolean }[] = [];
export let crossRecipes: CrossRecipe[] = [];
export let gradeRows: GradeRow[] = [];
export const achievements = new Map<string, Achievement>();
export const boatTypes = new Map<string, BoatType>();
export const notificationTexts = new Map<string, string>();
/** Sidegrade family -> the base object type it upgrades from. */
export const familyBase = new Map<string, string>();
export let neighbor: Neighbor | null = null;
export const visitorTypes: ItemType[] = [];
export const keeperTypes: ItemType[] = [];

const num = (v: unknown, d = 0) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v)).replace(/\\n/g, '\n');

const SMART_FAMILY: Record<number, string> = { 1: 'SmartSidewalk_', 2: 'SmartRiver_', 3: 'Sidewalk_', 4: 'River_', 5: 'Shrub_' };
const LOCKED_TABLES = new Set(['LockedAnimals', 'LockedNoninteractive', 'SproutLockedAnimals', 'SproutLockedNoninteractive']);

function categorize(r: Row, table: string): Category {
  const t = String(r.type ?? '');
  if (/AnimalObjectTypes|LockedAnimals/.test(table) || /Cage$/.test(t)) return 'animal';
  if (t === 'Tree') return 'tree';
  if (t === 'ZooKeeper') return 'staff';
  if (t === 'FoodVendor' || t === 'Facility' || t === 'SupportStructure') return 'building';
  if (/Sidewalk|River/.test(t) || (t === 'Wall' && num(r.isSmart))) return 'path';
  if (t === 'NormalDecoration' || t === 'Wall') return 'decoration';
  return 'internal';
}

/**
 * Shops and facilities earned money from visitors in the original, through rules in the
 * encrypted binary. Here they pay out hourly, scaled by the CSV "value" column.
 */
function buildingIncome(category: Category, value: number): Partial<ItemType> {
  if (category !== 'building') return {};
  return { growMinutes: 60, harvestCoins: Math.max(20, Math.round(value * 0.04)), harvestXp: Math.max(1, Math.round(value * 0.0005)) };
}

function makeItem(r: Row, table: string): ItemType {
  const name = String(r.name);
  const category = categorize(r, table);
  const w = num(r.width, 1), h = num(r.height, 1);
  let still = resolveSprite(r.image as string);
  if (!still && r.imagesBaseName) still = resolveSprite(`${r.imagesBaseName}.png`);
  const walkBase = r.imagesBaseName && resolveSprite(`${r.imagesBaseName}_ur_1.png`) ? String(r.imagesBaseName) : undefined;
  const missingArt = !still && !walkBase;
  if (missingArt && category !== 'staff' && category !== 'internal') still = placeholderSprite(name, w, h);
  const frames = still && !missingArt ? animFrames(still) : [];
  const thumbName = String(r.thumbnailImage ?? '').replace(/\.pvr$/, '.png');
  const smart = num(r.isSmart) && num(r.smartType) ? SMART_FAMILY[num(r.smartType)] : undefined;
  const unitMs = num(r.feedingTimesUnit) === 1 ? 3_600_000 : 60_000;
  return {
    name,
    display: String(r.displayName || name),
    rowType: String(r.type ?? ''),
    category,
    level: num(r.requiredExperienceLevel, 1),
    price: num(r.buyPrice),
    gold: num(r.unit) === 1,
    sellPrice: num(r.sellPrice),
    xpBuy: num(r.experienceFromBuying),
    w,
    h,
    sprite: still,
    frames,
    frameMs: num(r.animationDelayInterval, 100),
    xflip: num(r.xflip) === 1,
    thumb: hasImage(thumbName) ? thumbName : '',
    missingArt,
    growMinutes: num(r.minutesToGrow),
    harvestCoins: num(r.amountOfMoneyForHarvesting),
    harvestXp: num(r.experienceFromHarvesting),
    breedable: num(r.breedable) === 1,
    breedCost: num(r.breedingCost),
    breedGold: num(r.unit) === 1,
    breedMs: Math.max(1, num(r.feedingTimes, 1)) * unitMs,
    marginHours: num(r.marginForError, -1),
    reviveCost: num(r.reviveCost, 1),
    expediteGold: num(r.expediteBreedCost, 1),
    maxCount: num(r.maxToBreed, 1),
    maxOwned: num(r.maxToPurchase, -1),
    value: num(r.value),
    quality: num(r.quality, 1),
    purchaseable: num(r.purchaseable) === 1 && !/_\d+$|_More$/.test(name),
    locked: LOCKED_TABLES.has(table),
    family: r.family ? String(r.family) : undefined,
    smartFamily: smart,
    walkBase,
    tipText: r.tipBoxText ? String(r.tipBoxText) : undefined,
    ...buildingIncome(category, num(r.value)),
  };
}

function parseAchievement(r: Row): Achievement {
  const list = (v: unknown) => str(v).split('-').filter(Boolean);
  // Rewards can carry JSON ({"y":"_3"} uses "_" for minus), so match whole "verb:value" parts.
  const rewards = str(r.rewards).match(/[A-Za-z]+:(\{[^}]*\}|[^-]*)/g) ?? [];
  return {
    id: String(r.identifier),
    name: str(r.name),
    description: str(r.description),
    requirements: list(r.requirements),
    prerequisites: list(r.prerequisites),
    rewards,
    priority: num(r.priority, 100),
    invisible: num(r.invisible) === 1,
    autocomplete: num(r.autocomplete) === 1,
    suppressMessage: num(r.suppressCompletionMessage) === 1,
    fallThrough: r.fallThrough ? String(r.fallThrough) : undefined,
    icon: str(r.activeIcon),
    completedIcon: str(r.completedIcon),
    completionTitle: r.completionTitle ? str(r.completionTitle) : undefined,
    completionText: r.completionDescription ? str(r.completionDescription) : undefined,
    completionImage: r.completionImage ? str(r.completionImage) : undefined,
    initTitle: r.initTitle ? str(r.initTitle) : undefined,
    initText: r.initMessage ? str(r.initMessage) : undefined,
    initImage: r.initImage ? str(r.initImage) : undefined,
  };
}

export async function loadData(): Promise<void> {
  await loadCustomArtIndex();
  const tables = [
    'AnimalObjectTypes',
    'GameObjectTypes',
    'GameObjectTypesNonInteractive',
    'SmartObjects',
    'LockedAnimals',
    'LockedNoninteractive',
    'SproutLockedAnimals',
    'SproutLockedNoninteractive',
    'ZooSproutObjects',
  ];
  for (const t of tables) {
    for (const r of await fetchJson<Row[]>(`data/${t}.json`)) {
      if (!r.name || items.has(String(r.name))) continue;
      const it = makeItem(r, t);
      items.set(it.name, it);
      if (/VisitorAvatar/.test(it.rowType) && it.walkBase) visitorTypes.push(it);
      if (it.rowType === 'ZookeeperAvatar' && it.walkBase) keeperTypes.push(it);
    }
  }
  // Expansion pack: new store animals, then hybrids whose stats follow their parents' levels.
  for (const r of expansionAnimals()) if (!items.has(String(r.name))) items.set(String(r.name), makeItem(r, 'AnimalObjectTypes'));
  // Crossbreed-only parents are all listed at level 1; estimate their tier from breeding time.
  const effectiveLevel = (n: string) => {
    const t = items.get(n);
    if (!t) return undefined;
    return t.purchaseable ? t.level : Math.max(3, Math.min(50, Math.round(t.breedMs / 3_600_000 / 4.5)));
  };
  const expansion = expansionHybrids(effectiveLevel, (n) => items.get(n)?.rowType);
  for (const r of expansion.rows) if (!items.has(String(r.name))) items.set(String(r.name), makeItem(r, 'AnimalObjectTypes'));

  // Rangers share the two bundled walking sprites.
  for (const it of items.values()) {
    if (it.category === 'staff') it.walkBase = /Rhonda|Samantha|Rebecca|Amy|Bella|Adriana|Carol|Zara|Ann|Carrie|April|Allison|Jennifer|Ellen/.test(it.name) ? 'zookeeper_walk' : 'maleranger';
  }
  // Swap in user-supplied art where present.
  await Promise.all(
    [...items.values()].map(async (it) => {
      const key = await loadCustomArt(it.name);
      if (key) {
        it.sprite = key;
        it.frames = [];
        it.missingArt = false;
      }
    }),
  );

  levels = (await fetchJson<Row[]>('data/ExperienceLevels.json'))
    .map((r) => ({ level: num(r.level), xp: num(r.experience), coins: num(r.coinReward), gold: num(r.goldReward) }))
    .filter((l) => l.level >= 1);
  dailyBonus = await fetchJson<Row[]>('data/DailyBonus.json');
  const costs = (rows: Row[]) => rows.map((r) => ({ cost: num(r.cost), gold: num(r.currency) === 1 }));
  breedingSlotCosts = costs(await fetchJson<Row[]>('data/BreedingSlotCosts.json'));
  crossSlotCosts = costs(await fetchJson<Row[]>('data/CrossBreedingSlotCosts.json'));
  crossRecipes = [...(await fetchJson<Row[]>('data/CrossBreedingCombinations.json')), ...expansion.recipes]
    .map((r) => ({ result: String(r.c), a: String(r.a), b: String(r.b) }))
    .filter((r) => items.has(r.result) && items.has(r.a) && items.has(r.b));
  gradeRows = (await fetchJson<Row[]>('data/GradeRequirements.json')).map((r) => ({
    level: num(r.level),
    animals: num(r.valueOfAnimals),
    parking: num(r.valueOfParkingLots),
    trashCans: num(r.valueOfTrashCans),
    shops: num(r.valueOfShoppingStores),
    food: num(r.valueOfFoodVendors),
    facilities: num(r.valueOfFacilities),
  }));
  for (const r of await fetchJson<Row[]>('data/BoatTypes.json')) {
    boatTypes.set(String(r.name), { name: String(r.name), dockedX: num(r.positionDockedX), dockedY: num(r.positionDockedY), speed: num(r.speed, 3) });
  }
  for (const r of await fetchJson<Row[]>('data/LocalNotifications.json')) {
    if (num(r.isEnabled)) notificationTexts.set(String(r.notificationName), String(r.text));
  }
  for (const f of ['Tutorial', 'Achievements2', 'Achievements3', 'SidegradesAchievements', 'AchievementsSprout']) {
    for (const r of await fetchJson<Row[]>(`data/${f}.json`)) {
      const a = parseAchievement(r);
      if (!achievements.has(a.id)) achievements.set(a.id, a);
    }
  }
  // Sidegrade families: "<family>1" achievements put a "!" on the family and follow a "<family>0"
  // achievement that requires the base object ("Get:Ice Cream Shop").
  for (const a of achievements.values()) {
    const fam = a.rewards.find((x) => x.startsWith('PutExclamationOn:'))?.split(':')[1];
    const base = fam && a.prerequisites.map((p) => achievements.get(p)).find(Boolean)?.requirements[0]?.split(':')[1];
    if (fam && base && items.has(base) && !familyBase.has(fam)) familyBase.set(fam, base);
  }
  try {
    neighbor = await fetchJson<Neighbor>('data/neighbor.json');
  } catch {
    neighbor = null;
  }

  const floors = new Map((await fetchJson<Row[]>('data/CompositeFloorTypes.json')).map((r) => [String(r.name), r]));
  for (const p of await fetchJson<Row[]>('data/MapParameters.json')) {
    const id = String(p.MapName);
    let m: { pieces: Row[]; walk?: [number, number][]; place?: [number, number][] };
    try {
      m = await fetchJson(`maps/${id}.json`);
    } catch {
      continue;
    }
    maps.push({
      id,
      w: num(p.Width),
      h: num(p.Height),
      cost: num(p.Cost),
      buildMinutes: num(p.BuildTimeInMinutes),
      expediteGold: num(p.ExpediteCost),
      signs: [
        [num(p.mp1x), num(p.mp1y)],
        [num(p.mp2x), num(p.mp2y)],
      ],
      pieces: m.pieces.map((q) => {
        const f = floors.get(String(q.name));
        return { sprite: resolveSprite(String(f?.image ?? q.name)), flip: num(f?.xflip) === 1, x: num(q.x), y: num(q.y) };
      }),
      walk: m.walk ?? [],
      place: m.place ?? [],
    });
  }
}

export function levelForXp(xp: number): number {
  let lv = 1;
  for (const l of levels) if (xp >= l.xp) lv = Math.max(lv, l.level);
  return lv;
}

export function xpForLevel(level: number): number {
  return levels.find((l) => l.level === level)?.xp ?? Infinity;
}

/** Animals that appear in any crossbreeding recipe as a parent. */
export function crossParents(): Set<string> {
  return new Set(crossRecipes.flatMap((r) => [r.a, r.b]));
}

export function recipeFor(a: string, b: string): CrossRecipe | undefined {
  return crossRecipes.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
}

export function thumbUrl(it: ItemType): string {
  if (it.thumb && !it.sprite?.startsWith('custom:')) return `./game/img/${it.thumb}`;
  if (it.sprite) return spriteDataUrl(it.sprite);
  if (it.walkBase) {
    const k = resolveSprite(`${it.walkBase}_dr_1.png`);
    if (k) return spriteDataUrl(k);
  }
  return '';
}
