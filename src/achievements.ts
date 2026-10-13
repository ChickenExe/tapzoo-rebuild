// Data-driven goals: Tutorial.csv, Achievements2/3.csv, SidegradesAchievements.csv and
// AchievementsSprout.csv share one requirement/reward grammar (the original AchievementsModel).
// Requirements: "Get:Owl:1:icon.png-CrossBreed:Macaw:1" ; rewards: "coins:100-exp:10-unlock:Tapir".
import { achievements, Achievement, boatTypes, items } from './data';
import type { Game } from './game';
import { gradeReport, GradeName } from './grades';

export interface ReqProgress {
  text: string;
  have: number;
  need: number;
  done: boolean;
  icon?: string;
  offline?: boolean;
}

export type AchEvent =
  | { kind: 'started'; a: Achievement }
  | { kind: 'completed'; a: Achievement; rewardText: string }
  | { kind: 'sailAway'; boat: string };

/** Social goals needed Facebook, email, SMS or Pocket Gems' friend servers; they count as done. */
const SOCIAL = new Set(['SendEmails', 'SendSMSs', 'FBPostOwnWall', 'FBPostFriendsWalls', 'GetNeighbors', 'DidSignUpForEmails']);
const HOUR = 3_600_000;

const CLASS_NAMES: Record<string, string> = {
  AnimalCage: 'animals',
  MammalCage: 'mammals',
  BirdCage: 'birds',
  ReptileCage: 'reptiles',
  FishCage: 'fish',
  InsectCage: 'insects',
  InvertebrateCage: 'invertebrates',
  DinosaurCage: 'dinosaurs',
};
const nice = (x: string) => CLASS_NAMES[x] ?? x;

export class Achievements {
  private listeners: ((e: AchEvent) => void)[] = [];

  constructor(private game: Game) {}

  on(fn: (e: AchEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(e: AchEvent): void {
    for (const l of this.listeners) l(e);
  }

  isDone(id: string): boolean {
    return this.game.s.achDone.includes(id);
  }

  /** Unfinished goals whose prerequisites are all complete. */
  active(): Achievement[] {
    const out: Achievement[] = [];
    for (const a of achievements.values()) {
      if (this.isDone(a.id)) continue;
      if (a.prerequisites.every((p) => this.isDone(p) || !achievements.has(p))) out.push(a);
    }
    return out;
  }

  /** Goals shown to the player, most important first. */
  visible(): Achievement[] {
    return this.active()
      .filter((a) => !a.invisible && a.name)
      .sort((x, y) => x.priority - y.priority);
  }

  completed(): Achievement[] {
    return this.game.s.achDone.map((id) => achievements.get(id)!).filter((a) => a && !a.invisible && a.name);
  }

  private since(a: Achievement): number {
    return this.game.s.achStarted[a.id] ?? Date.now();
  }

  private baseline(a: Achievement, key: string): number {
    return this.game.s.achBaseline[a.id]?.[key] ?? 0;
  }

  progress(a: Achievement, req: string): ReqProgress {
    const g = this.game;
    const p = req.split(':');
    const verb = p[0];
    const icon = p.find((x) => x.endsWith('.png'));
    const n = (i: number, d = 1) => (p[i] !== undefined && !isNaN(Number(p[i])) ? Number(p[i]) : d);
    const res = (text: string, have: number, need: number): ReqProgress => ({ text, have, need, done: have >= need, icon });
    if (SOCIAL.has(verb)) return { text: `${verb.replace(/([A-Z])/g, ' $1').trim()} (needs online friends — counted as done)`, have: 1, need: 1, done: true, icon, offline: true };
    switch (verb) {
      case 'Level':
        return res(`Reach level ${n(1)}`, g.level, n(1));
      case 'Get': {
        const it = items.get(p[1]);
        return res(`Have ${n(2)} ${it ? it.display : nice(p[1])}`, g.owned(p[1]), n(2));
      }
      case 'Species':
        return res(`Have ${n(2)} species of ${nice(p[1])}`, g.species(p[1]), n(2));
      case 'CrossBreed':
      case 'MysteryCrossBreed':
        return res(`Crossbreed ${n(2)} ${items.get(p[1])?.display ?? nice(p[1])}`, g.stat(`cross:${p[1]}`), n(2));
      case 'MoreCrossBreed':
        return res(`Crossbreed ${n(1)} more animal${n(1) > 1 ? 's' : ''}`, g.stat('crossAny') - this.baseline(a, 'crossAny'), n(1));
      case 'Breed':
        return res(`Breed ${n(2)} ${items.get(p[1])?.display ?? nice(p[1])}`, g.stat(`bred:${p[1]}`), n(2));
      case 'MoreBreed':
        return res(`Breed ${n(1)} more animal${n(1) > 1 ? 's' : ''}`, g.stat('breedAny') - this.baseline(a, 'breedAny'), n(1));
      case 'SaveSick':
        return res(`Nurse ${n(2)} sick ${nice(p[1])} back to health`, g.stat(`saveSick:${p[1]}`), n(2));
      case 'Grade': {
        const grade = gradeReport(g).grades[(p[1] === 'Restaurant' ? 'Restaurant' : p[1]) as GradeName] ?? 0;
        return res(`Get a ${p[1]} grade of ${n(2)}`, grade, n(2));
      }
      case 'LogIn': {
        const start = new Date(this.since(a)).setHours(0, 0, 0, 0);
        const days = g.s.loginDays.filter((d) => new Date(d).getTime() >= start).length;
        return res(`Play on ${n(1)} different days`, days, n(1));
      }
      case 'ComeBack': {
        const h = (Date.now() - this.since(a)) / HOUR;
        return res(`Come back in ${n(1)} hour${n(1) > 1 ? 's' : ''}`, Math.min(n(1), Math.floor(h * 10) / 10), n(1));
      }
      case 'ComeBackSeconds':
        return res('Come back shortly', (Date.now() - this.since(a)) / 1000, n(1));
      case 'PickUpTrash':
        return res(`Pick up ${n(1)} pieces of trash`, g.stat('trash'), n(1));
      case 'GetVisitors':
        // The original counted friend visits; offline, it's a busy zoo of 100 visitors/day per point.
        return res(`Attract ${n(1) * 100} visitors a day`, g.visitorsPerDay(), n(1) * 100);
      case 'GetLandNumber':
        return res(`Expand your land ${n(1)} time${n(1) > 1 ? 's' : ''}`, g.s.mapIndex, n(1));
      case 'ClickOn':
        return res(`Tap the ${p[1]}`, g.stat(`click:${p[1]}`) - this.baseline(a, `click:${p[1]}`), 1);
      case 'TutorialKey':
        return res(p[1], g.s.tutorialKeys.includes(p[1]) ? 1 : 0, 1);
      case 'DidStartBreeding':
        return res('Start breeding in the Nursery', Math.min(1, g.stat('DidStartBreeding')), 1);
      case 'DidCollectRevenue':
        return res('Collect ticket money at the gate', Math.min(1, g.stat('DidCollectRevenue')), 1);
      case 'DidVisitNeighbor':
        return res('Visit your neighbor', Math.min(1, g.stat('DidVisitNeighbor')), 1);
      default:
        return { text: req, have: 1, need: 1, done: true, icon };
    }
  }

  private start(a: Achievement): void {
    const g = this.game;
    g.s.achStarted[a.id] = Date.now();
    const keys = ['crossAny', 'breedAny', ...a.requirements.filter((r) => r.startsWith('ClickOn:')).map((r) => `click:${r.split(':')[1]}`)];
    g.s.achBaseline[a.id] = Object.fromEntries(keys.map((k) => [k, g.stat(k)]));
    if (!a.invisible) this.emit({ kind: 'started', a });
  }

  private updating = false;

  /** Evaluates every active goal; call after state changes and on a timer. */
  update(): void {
    if (this.updating) return;
    this.updating = true;
    try {
      this.evaluate();
    } finally {
      this.updating = false;
    }
  }

  private evaluate(): void {
    const g = this.game;
    for (let pass = 0; pass < 10; pass++) {
      let progressed = false;
      for (const a of this.active()) {
        if (!(a.id in g.s.achStarted)) this.start(a);
        // fallThrough: an outdated tutorial step is skipped once the player is past it.
        if (a.fallThrough && this.isDone(a.fallThrough)) {
          this.markDone(a.id);
          progressed = true;
          continue;
        }
        if (a.requirements.every((r) => this.progress(a, r).done)) {
          if (!this.markDone(a.id)) continue;
          const rewardText = this.applyRewards(a);
          if (!a.suppressMessage && !a.invisible) this.emit({ kind: 'completed', a, rewardText });
          progressed = true;
        }
      }
      if (!progressed) break;
      g.save();
    }
  }

  /** Records completion once; false if it was already done. */
  private markDone(id: string): boolean {
    if (this.isDone(id)) return false;
    this.game.s.achDone.push(id);
    return true;
  }

  private parseSpec(json: string): { name: string; x?: number; y?: number } {
    const o = JSON.parse(json) as Record<string, string>;
    const coord = (v?: string) => (v === undefined ? undefined : Number(v.replace('_', '-')));
    return { name: o.name, x: coord(o.x), y: coord(o.y) };
  }

  private applyRewards(a: Achievement): string {
    const g = this.game;
    const parts: string[] = [];
    for (const r of a.rewards) {
      const i = r.indexOf(':');
      const verb = r.slice(0, i), arg = r.slice(i + 1);
      switch (verb) {
        case 'coins':
          g.s.coins += Number(arg);
          parts.push(`${Number(arg).toLocaleString('en-US')} coins`);
          break;
        case 'gold':
          g.s.gold += Number(arg);
          parts.push(`${arg} stars`);
          break;
        case 'exp':
          g.addXp(Number(arg));
          parts.push(`${Number(arg).toLocaleString('en-US')} XP`);
          break;
        case 'unlock':
          if (!g.s.unlocked.includes(arg)) g.s.unlocked.push(arg);
          parts.push(`${arg} unlocked`);
          break;
        case 'give': {
          const spec = this.parseSpec(arg);
          if (boatTypes.has(spec.name)) {
            g.s.boats = g.s.boats.filter((b) => !b.sailingSince);
            g.s.boats.push({ type: spec.name });
          } else if (items.has(spec.name)) {
            if (spec.x !== undefined && spec.y !== undefined) {
              // Story objects (the dock) go to fixed spots, even just off the island.
              g.s.objects.push({ id: g.s.nextId++, type: spec.name, x: spec.x, y: spec.y, flip: false });
              g.reindex();
            } else g.addToInventory(spec.name);
          }
          break;
        }
        case 'remove': {
          const spec = this.parseSpec(arg);
          const hit = g.s.objects.find((o) => o.type === spec.name && (spec.x === undefined || (o.x === spec.x && o.y === spec.y)));
          if (hit) {
            g.s.objects = g.s.objects.filter((o) => o !== hit);
            g.reindex();
          }
          break;
        }
        case 'SailAway': {
          const spec = this.parseSpec(arg);
          const boat = g.s.boats.find((b) => b.type === spec.name) ?? g.s.boats[g.s.boats.length - 1];
          if (boat) {
            boat.sailingSince = Date.now();
            this.emit({ kind: 'sailAway', boat: boat.type });
          }
          break;
        }
        case 'ReplaceAnimation': {
          const [from, to] = arg.split(':');
          for (const o of g.s.objects) if (o.type === from && items.has(to)) o.type = to;
          g.reindex();
          break;
        }
        case 'PutExclamationOn':
          if (!g.s.exclaimFamilies.includes(arg)) g.s.exclaimFamilies.push(arg);
          break;
        case 'Collect': {
          const h = g.habitatOf(arg);
          if (h) h.cycleStart = 0;
          break;
        }
      }
    }
    g.save();
    g.emit({ kind: 'changed' });
    return parts.join(', ');
  }
}
