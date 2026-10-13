// Expansion pack: 100 new store animals and 51 new crossbreed-only hybrids, added on top of the
// original catalog. Rows use the same columns as AnimalObjectTypes.csv so they flow through the
// normal loader; stats follow curves fitted to the original animals (price, payout, breeding
// time and XP by level), with a little per-animal variation.

type Row = Record<string, string | number | undefined>;

type Cls = 'MammalCage' | 'BirdCage' | 'ReptileCage' | 'FishCage' | 'InsectCage' | 'InvertebrateCage' | 'DinosaurCage';

/** [name, level, class, footprint, star price (0 = coins)] */
type Spec = [string, number, Cls, number, number];

const M: Cls = 'MammalCage', B: Cls = 'BirdCage', R: Cls = 'ReptileCage', F: Cls = 'FishCage', I: Cls = 'InsectCage', V: Cls = 'InvertebrateCage', D: Cls = 'DinosaurCage';

const ANIMALS: Spec[] = [
  // Early zoo (levels 1-5)
  ['Meerkat', 1, M, 2, 0], ['Llama', 2, M, 3, 0], ['Pika', 2, M, 2, 0], ['Coati', 3, M, 2, 0], ['Leopard Gecko', 3, R, 2, 0],
  ['Clownfish', 3, F, 2, 0], ['Kookaburra', 3, B, 2, 0], ['Banded Mongoose', 4, M, 2, 0], ['Sugar Glider', 4, M, 2, 0], ['Bearded Dragon', 4, R, 2, 0],
  ['Blue Tang', 4, F, 2, 0], ['Pelican', 4, B, 3, 0], ['Warthog', 5, M, 3, 0], ['Wallaby', 5, M, 3, 0], ['Firefly', 5, I, 2, 0],
  ['Quokka', 5, M, 2, 6], ['Axolotl', 5, R, 2, 9],
  // Growing zoo (6-12)
  ['Arctic Fox', 6, M, 3, 0], ['Skunk', 6, M, 2, 0], ['Green Iguana', 6, R, 2, 0], ['Seahorse', 6, F, 2, 0], ['Emu', 6, B, 3, 0],
  ['Kinkajou', 7, M, 2, 0], ['Serval', 7, M, 3, 0], ['Roseate Spoonbill', 7, B, 2, 0], ['Praying Mantis', 7, I, 2, 0], ['Horseshoe Crab', 7, V, 2, 0],
  ['Reindeer', 8, M, 3, 0], ['Blackbuck', 8, M, 3, 0], ['Cockatoo', 8, B, 2, 0], ['Lionfish', 8, F, 2, 0], ['Giant Otter', 8, M, 3, 21],
  ['Honey Badger', 9, M, 3, 0], ['Springbok', 9, M, 3, 0], ['Hornbill', 9, B, 2, 0], ['Gila Monster', 9, R, 2, 0], ['Electric Eel', 9, F, 3, 0],
  ['Binturong', 10, M, 3, 0], ['Gibbon', 10, M, 3, 0], ['Crowned Crane', 10, B, 3, 0], ['Atlas Moth', 10, I, 2, 0], ['Manatee', 10, M, 4, 38],
  ['Fishing Cat', 11, M, 3, 0], ['Nyala', 11, M, 3, 0], ['Basilisk Lizard', 11, R, 2, 0], ['Mantis Shrimp', 11, V, 2, 0], ['Lyrebird', 11, B, 2, 29],
  ['Bat-Eared Fox', 12, M, 3, 0], ['Colobus Monkey', 12, M, 3, 0], ['Secretary Bird', 12, B, 3, 0], ['Arapaima', 12, F, 3, 0], ['Rhinoceros Beetle', 12, I, 2, 0],
  // Established zoo (13-24)
  ['Bongo', 13, M, 3, 0], ['Gerenuk', 13, M, 3, 0], ['Marine Iguana', 13, R, 3, 0], ['Sawfish', 13, F, 3, 0], ['Clouded Leopard', 13, M, 3, 49],
  ['Pallas Cat', 14, M, 3, 0], ['Kea', 14, B, 2, 0], ['Nile Monitor', 14, R, 3, 0], ['Leafcutter Ants', 14, I, 2, 0],
  ['Sifaka', 15, M, 3, 0], ['Gemsbok', 15, M, 3, 0], ['Albatross', 15, B, 3, 0], ['Nautilus', 15, V, 2, 55],
  ['Proboscis Monkey', 16, M, 3, 0], ['Takin', 16, M, 3, 0], ['Tawny Frogmouth', 16, B, 2, 0], ['Giant Clam', 16, V, 2, 0],
  ['Fossa', 17, M, 3, 64], ['Saiga', 17, M, 3, 0], ['Vulture', 17, B, 3, 0], ['Alligator Snapping Turtle', 18, R, 3, 0],
  ['Snow Monkey', 18, M, 3, 72], ['Spectacled Bear', 18, M, 4, 0], ['Gelada', 19, M, 3, 0], ['Blue-Footed Booby', 19, B, 2, 0],
  ['Dhole', 20, M, 3, 0], ['Galapagos Tortoise', 20, R, 3, 0], ['Kakapo', 20, B, 2, 85], ['Whale Shark', 21, F, 5, 99],
  ['Aardwolf', 21, M, 3, 0], ['Tuatara', 22, R, 2, 0], ['Marabou Stork', 22, B, 3, 0], ['Coelacanth', 23, F, 3, 119],
  ['Black Rhino', 23, M, 4, 0], ['Siamang', 24, M, 3, 0],
  // Late game (25-50)
  ['Addax', 25, M, 3, 0], ['Tamandua', 28, M, 3, 0], ['Olinguito', 31, M, 2, 0], ['Quoll', 33, M, 2, 0],
  ['Nilgai', 35, M, 4, 0], ['Triceratops', 36, D, 5, 149], ['Onager', 38, M, 4, 0], ['Pteranodon', 40, D, 4, 179], ['Muntjac', 42, M, 3, 0],
  ['Ring-Tailed Cat', 44, M, 2, 0], ['Hartebeest', 46, M, 4, 0], ['Brachiosaurus', 48, D, 5, 249], ['Water Deer', 50, M, 3, 0],
];

/** [hybrid, parent A, parent B, mythic] */
const HYBRIDS: [string, string, string, boolean][] = [
  ['Kirin', 'Giraffe', 'Unicorn', true],
  ['Crocorilla', 'Crocodile', 'Gorilla', false],
  ['Manticore', 'Lion', 'Scorpion', true],
  ['Narluga', 'Narwhal', 'Beluga Whale', false],
  ['Kraken', 'Giant Squid', 'Octopus', true],
  ['Jaglion', 'Jaguar', 'Lion', false],
  ['Coywolf', 'Coyote', 'Gray Wolf', false],
  ['Cama', 'Bactrian Camel', 'Llama', false],
  ['Yakalo', 'Yak', 'Water Buffalo', false],
  ['Savannah Cat', 'Serval', 'Kitten', false],
  ['Geep', 'Ibex', 'Bighorn Sheep', false],
  ['Hippogriff', 'Griffin', 'Arabian Horse', true],
  ['Thunderbird', 'Bald Eagle', 'Phoenix', true],
  ['Sphinx', 'Lion', 'Harpy Eagle', true],
  ['Chimera', 'Lion', 'Boa Constrictor', true],
  ['Hydra', 'Green Iguana', 'Anaconda', true],
  ['Kitsune', 'Arctic Fox', 'Fennec Fox', true],
  ['Wyvern', 'Pteranodon', 'Komodo Dragon', true],
  ['Leviathan', 'Whale Shark', 'Giant Squid', true],
  ['Cerberus', 'Gray Wolf', 'Neapolitan Mastiff', true],
  ['Jackalope', 'Desert Hare', 'Springbok', true],
  ['Hippocampus', 'Seahorse', 'Arabian Horse', true],
  ['Bunyip', 'Platypus', 'Manatee', true],
  ['Moon Rabbit', 'Angora Rabbit', 'Pika', true],
  ['Dragon Turtle', 'Galapagos Tortoise', 'Green Dragon', true],
  ['Koalaroo', 'Koala', 'Kangaroo', false],
  ['Pandacoon', 'Red Panda', 'Raccoon', false],
  ['Zebrapi', 'Okapi', 'Zebra', false],
  ['Flamingbill', 'Flamingo', 'Roseate Spoonbill', false],
  ['Macatoo', 'Macaw', 'Cockatoo', false],
  ['Kakiwi', 'Kakapo', 'Kiwi', false],
  ['Emustrich', 'Emu', 'Ostrich', false],
  ['Bucketbill', 'Pelican', 'Shoebill', false],
  ['Laughing Hornbill', 'Kookaburra', 'Hornbill', false],
  ['Song Peacock', 'Lyrebird', 'Peacock', false],
  ['Sunset Crane', 'Crowned Crane', 'Flamingo', false],
  ['Sky Swan', 'Albatross', 'Swan', false],
  ['Misty Leopard', 'Clouded Leopard', 'Snow Leopard', false],
  ['Shadow Lemur', 'Fossa', 'Lemur', false],
  ['Quallaby', 'Quokka', 'Wallaby', false],
  ['Glider Sprite', 'Sugar Glider', 'Flying Squirrel', true],
  ['Grizzle Badger', 'Honey Badger', 'Wolverine', false],
  ['Frost Stag', 'Reindeer', 'Moose', false],
  ['Mermatee', 'Manatee', 'Dugong', true],
  ['Otterlord', 'Giant Otter', 'River Otter', false],
  ['Lantern Moth', 'Firefly', 'Atlas Moth', false],
  ['Prism Gecko', 'Leopard Gecko', 'Chameleon', false],
  ['Axolamander', 'Axolotl', 'Tiger Salamander', false],
  ['Reef Jester', 'Clownfish', 'Blue Tang', false],
  ['Thunder Ray', 'Electric Eel', 'Stingray', false],
  ['Trihorn', 'Triceratops', 'Rhino', true],
];

// Original coin prices by level (medians of AnimalObjectTypes.csv), interpolated in log space.
const PRICE_ANCHORS: [number, number][] = [
  [1, 25], [2, 80], [3, 520], [4, 1200], [5, 5000], [6, 8750], [8, 33000], [10, 200000], [13, 420000], [15, 490000],
  [18, 900000], [20, 2500000], [23, 10000000], [25, 17500000], [30, 34500000], [35, 140000000], [40, 230000000], [45, 380000000], [50, 630000000],
];

const coinPrice = (level: number) => interp(PRICE_ANCHORS, level);

// Original coins per hour by level (medians of AnimalObjectTypes.csv), interpolated in log space.
const INCOME_ANCHORS: [number, number][] = [
  [1, 300], [3, 800], [5, 800], [8, 600], [10, 800], [13, 1400], [16, 2200], [20, 3600], [22, 9000], [25, 20000],
  [28, 32000], [30, 36000], [35, 38000], [40, 50000], [45, 60000], [50, 71000],
];

function interp(anchors: [number, number][], level: number): number {
  for (let k = 1; k < anchors.length; k++) {
    const [l1, p1] = anchors[k - 1], [l2, p2] = anchors[k];
    if (level <= l2) return Math.exp(Math.log(p1) + ((level - l1) / (l2 - l1)) * (Math.log(p2) - Math.log(p1)));
  }
  return anchors[anchors.length - 1][1];
}

const coinsPerHour = (level: number) => interp(INCOME_ANCHORS, level);

/** Stable 0..1 value per name, so stats don't change between launches. */
function rand(name: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

const GROW = [5, 30, 60, 120, 180, 240, 360, 480, 720, 960, 1440];
const nice = (n: number) => {
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, n))) - 1);
  return Math.max(1, Math.round(n / mag) * mag);
};
const slug = (n: string) => `x_${n.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

function animalRow(name: string, level: number, cls: Cls, size: number, stars: number, purchaseable: boolean, payBoost = 1): Row {
  const price = coinPrice(level) * (0.8 + 0.4 * rand(name, 1));
  const perHour = coinsPerHour(level) * (0.85 + 0.3 * rand(name, 4)) * payBoost;
  const growIdx = Math.min(GROW.length - 1, Math.max(0, Math.round(level / 4 + rand(name, 2) * 3) - (level < 3 ? 1 : 0)));
  const grow = level <= 1 ? 5 : GROW[growIdx];
  const harvest = nice((perHour * grow) / 60);
  const breedHours = level <= 4 ? 0 : Math.round(4 + level * 3.6 + rand(name, 3) * 8);
  const breedMinutes = level <= 4 ? [1, 30, 45, 60][level - 1] : 0;
  return {
    name,
    type: cls,
    requiredExperienceLevel: purchaseable ? level : 1,
    unit: stars ? 1 : 0,
    buyPrice: stars || nice(price),
    experienceFromBuying: nice(Math.pow(price, 0.75) * 0.7),
    minutesToGrow: grow,
    amountOfMoneyForHarvesting: harvest,
    experienceFromHarvesting: Math.max(1, Math.round(harvest * 0.077)),
    breedingCost: stars ? Math.max(1, Math.round(stars / 6)) : nice(price),
    expediteBreedCost: Math.max(1, Math.ceil((breedHours || 1) / 4) + 1),
    feedingTimes: String(breedHours || breedMinutes),
    feedingTimesUnit: breedHours ? 1 : 0,
    marginForError: level <= 4 ? -1 : breedHours,
    reviveCost: 1 + Math.floor(level / 10),
    sellPrice: stars ? 1 : nice(price / 5),
    value: nice(price * 0.8),
    quality: Math.min(4, 1 + Math.floor(level / 12)),
    width: size,
    height: size,
    breedable: 1,
    maxToBreed: 4,
    maxToPurchase: 2,
    purchaseable: purchaseable ? 1 : 0,
    isMovable: 1,
    isSellable: 1,
    layer: 3,
    image: `${slug(name)}.png`,
    thumbnailImage: `${slug(name)}_small.png`,
  };
}

export const EXPANSION_NAMES = new Set([...ANIMALS.map((a) => a[0]), ...HYBRIDS.map((h) => h[0])]);

/** Store animals; call before hybrids so their parents exist. */
export function expansionAnimals(): Row[] {
  return ANIMALS.map(([name, level, cls, size, stars]) => animalRow(name, level, cls, size, stars, true));
}

/**
 * Crossbreed-only hybrids. Their power follows the stronger parent, and they pay better than
 * store animals of that level (as the original hybrids did); mythic ones even more.
 */
export function expansionHybrids(levelOf: (name: string) => number | undefined, classOf: (name: string) => string | undefined): { rows: Row[]; recipes: { c: string; a: string; b: string }[] } {
  const rows: Row[] = [];
  const recipes: { c: string; a: string; b: string }[] = [];
  for (const [name, a, b, mythic] of HYBRIDS) {
    const la = levelOf(a), lb = levelOf(b);
    if (la === undefined || lb === undefined) continue;
    const level = Math.min(50, Math.max(3, Math.round((la + lb) / 2) + 2));
    const cls = (classOf(a) ?? 'MammalCage') as Cls;
    const row = animalRow(name, level, cls, 3, 0, false, mythic ? 2.4 : 1.6);
    // Hybrids are made in the crossbreeding lab: cost and incubation scale with their level.
    row.breedingCost = nice(coinPrice(level) * 0.5);
    row.feedingTimes = String(Math.min(240, Math.round(6 + level * 3.2 + (mythic ? 12 : 0))));
    row.feedingTimesUnit = 1;
    row.marginForError = -1;
    row.minutesToGrow = 1440;
    row.amountOfMoneyForHarvesting = nice(coinsPerHour(level) * 24 * (mythic ? 2.4 : 1.6));
    row.experienceFromHarvesting = Math.max(1, Math.round(Number(row.amountOfMoneyForHarvesting) * 0.077));
    row.expediteBreedCost = Math.max(2, Math.ceil(Number(row.feedingTimes) / 4) + 2);
    row.value = nice(coinPrice(level) * (mythic ? 1.5 : 1));
    row.quality = 4;
    rows.push(row);
    recipes.push({ c: name, a, b });
  }
  return { rows, recipes };
}
