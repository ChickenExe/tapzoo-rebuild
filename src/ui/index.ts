// HUD (StatusPanel), tool bar (ToolPanelView), goal dock, placement tab and event wiring.
import type { Achievements } from '../achievements';
import { crossParents, items, ItemType, notificationTexts, thumbUrl, xpForLevel } from '../data';
import type { Game, ZooObject } from '../game';
import { gradeReport, letter } from '../grades';
import { P, tileAt } from '../iso';
import type { Ghost, View } from '../view';
import { writeBackup } from '../host';
import { prefs } from '../prefs';
import { button, duration, el, escapeHtml, fmt, IMG, iconUrl, priceHtml } from './dom';
import { goalPopup, openGoal, openGoals } from './goals';
import { openCrossbreed, openNursery } from './nursery';
import { openObject, openSidegrades } from './object';
import { Panels } from './panels';
import { openStore } from './store';
import { goHome, helpNeighbor, openGrades, openLand, openOther } from './zoo';

export interface Ctx {
  game: Game;
  view: View;
  ach: Achievements;
  panels: Panels;
  ui: UI;
  crossParents: Set<string>;
}

export class UI {
  private root = el('div', 'ui');
  private hud = el('div', 'hud');
  private coinsEl = el('span');
  private goldEl = el('span');
  private levelEl = el('span', 'lv');
  private xpFill = el('div', 'xpfill');
  private xpText = el('span', 'xptext');
  private bonusFill = el('div', 'bonusfill');
  private gradeEl = el('button', 'gradebadge');
  private dock = el('div', 'dock');
  private toolbar = el('div', 'toolbar');
  private visitBar = el('div', 'visitbar hidden');
  private modeBar = el('div', 'modebar hidden');
  private proposeTab = el('div', 'propose hidden');
  private toasts = el('div', 'toasts');
  private tooltip = el('div', 'tooltip hidden');
  private collectBtn = el('button', 'collectall');
  private badges = new Map<string, HTMLElement>();
  private hoveredObj: ZooObject | null = null;
  private hoverAt = { x: 0, y: 0 };
  private mode: 'none' | 'move' | 'sell' = 'none';
  private music: HTMLAudioElement | null = null;
  readonly ctx: Ctx;

  constructor(game: Game, view: View, ach: Achievements) {
    document.body.append(this.root);
    const panels = new Panels(this.root);
    this.ctx = { game, view, ach, panels, ui: this, crossParents: crossParents() };
    this.buildHud();
    this.buildToolbar();
    this.buildProposeTab();
    this.root.append(this.dock, this.visitBar, this.modeBar, this.proposeTab, this.toasts, this.tooltip);
    this.applyPrefs();

    game.on((e) => {
      if (e.kind === 'changed') {
        ach.update();
        this.refresh();
      }
      if (e.kind === 'toast') this.toast(e.text);
      if (e.kind === 'coins' || e.kind === 'xp') {
        const a = this.anchor(e.x, e.y);
        if (e.kind === 'coins') this.ctx.view.addFx(`+${fmt(e.amount)}`, '#ffd84a', a.x, a.y);
        else this.ctx.view.addFx(`+${fmt(e.amount)} XP`, '#7ee0ff', a.x, a.y + 26);
      }
      if (e.kind === 'levelup') this.levelUp(e.level, e.coins, e.gold);
      if (e.kind === 'bonus') this.bonus(e.coins);
      if (e.kind === 'notify') this.notify(e.state, e.name, e.cross);
      if (e.kind === 'placeFromInventory') {
        const t = items.get(e.type);
        if (t) setTimeout(() => this.ctx.panels.enqueue(() => this.startPlacing(t, true)), 300);
      }
    });
    ach.on((e) => {
      if (e.kind === 'started' && (e.a.initTitle || e.a.initText)) {
        goalPopup(this.ctx, e.a.initTitle ?? e.a.name, e.a.initText ?? e.a.description, e.a.initImage, '');
      } else if (e.kind === 'started') this.toast(`New goal: ${e.a.name}`);
      if (e.kind === 'completed') {
        // Goals an existing zoo already meets complete together at startup; summarise those.
        if (this.startupBatch) this.startupBatch.push(e);
        else goalPopup(this.ctx, e.a.completionTitle ?? `${e.a.name} — complete!`, e.a.completionText ?? e.a.description, e.a.completionImage, e.rewardText ? `Reward: ${e.rewardText}` : '');
      }
      if (e.kind === 'sailAway') this.toast('Your boat set sail!');
      this.refreshDock();
    });

    // Read before the first tick bumps lastSeen.
    const awaySince = game.s.lastSeen;
    setInterval(() => {
      game.tick();
      ach.update();
      this.ctx.panels.refresh();
      this.refreshModeBar();
      this.refreshHudSlow();
      this.refreshTooltip();
    }, 1000);
    // A dated backup of the zoo shortly after launch and then hourly (the file is per day).
    const backup = () => writeBackup(game.exportSave());
    setTimeout(backup, 3000);
    setInterval(backup, 3_600_000);
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') this.cancel();
      if (e.key === 'Enter' && view.ghost?.proposed) this.confirmGhost();
      if (e.key === 'r' && view.ghost) this.rotateGhost();
      if (e.key === 'g') view.debugGrid = !view.debugGrid;
      if (e.key === ' ' && !view.ghost && !this.ctx.panels.isOpen) {
        e.preventDefault();
        this.collectAll();
      }
    });
    window.addEventListener('pointerdown', () => this.syncMusic(), { once: true });

    game.tutorialKey('intro');
    ach.update();
    setTimeout(() => this.flushStartup(), 2500);
    this.refresh();
    if (game.dailyAvailable()) this.ctx.panels.enqueue(() => this.dailyDialog());
    if (Date.now() - awaySince > 10 * 60_000) setTimeout(() => this.ctx.panels.enqueue(() => this.awaySummary(awaySince)), 2700);
  }

  applyPrefs(): void {
    document.documentElement.style.setProperty('--ui-scale', String(prefs.uiScale));
    if (this.music) this.music.volume = prefs.musicVolume;
  }

  /** Collect every ready habitat, shop and the gate in one go (GameState harvestEverything). */
  collectAll(): void {
    const { game, view } = this.ctx;
    if (view.visiting) return;
    for (const o of game.readyObjects()) view.coinBurst(o);
    const r = game.collectAll();
    this.toast(r.count ? `Collected from ${r.count} place${r.count > 1 ? 's' : ''}: +${fmt(r.coins)} coins` : 'Nothing is ready yet');
  }

  private awaySummary(since: number): void {
    const { game, panels } = this.ctx;
    const now = Date.now();
    const ready = game.readyObjects(now);
    const readyCoins = ready.reduce((sum, o) => sum + items.get(o.type)!.harvestCoins * (o.count ?? 1), 0);
    const tickets = game.pendingRevenue(now);
    const eggs = game.s.nests.filter((n) => n && game.nestState(n, now) === 'ready').length + game.s.crossNests.filter((n) => n && game.crossState(n, now) === 'ready').length;
    const sick = game.s.nests.filter((n) => n && game.nestState(n, now) === 'sick').length + game.s.crossNests.filter((n) => n && game.crossState(n, now) === 'sick').length;
    const trash = game.s.objects.filter((o) => items.get(o.type)!.rowType === 'Trash').length;
    const lines = [
      ready.length && `<b>${ready.length}</b> habitat${ready.length > 1 ? 's' : ''} and shops ready: ${priceHtml(readyCoins, false)}`,
      tickets > 0 && `Ticket money at the gate: ${priceHtml(tickets, false)}`,
      eggs && `<b>${eggs}</b> egg${eggs > 1 ? 's' : ''} hatched — collect in the Nursery`,
      sick && `<b>${sick}</b> egg${sick > 1 ? 's' : ''} got sick — revive them in the Nursery`,
      trash && `<b>${trash}</b> piece${trash > 1 ? 's' : ''} of trash to sweep up`,
    ].filter(Boolean);
    if (!lines.length) return;
    panels.open('info away', (p) => {
      p.append(el('h2', '', 'While you were away'));
      const body = el('div', 'body', `<p class="fine">You were gone ${duration(now - since)}.</p><ul class="awaylist">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`);
      const actions = el('div', 'actions');
      if (ready.length || tickets > 0)
        actions.append(
          button('btn', 'Collect all', () => {
            panels.close();
            this.collectAll();
          }),
        );
      if (eggs || sick) actions.append(button('btn ghost', 'Open Nursery', () => openNursery(this.ctx)));
      actions.append(button('btn ghost', 'OK', () => panels.close()));
      body.append(actions);
      p.append(body);
    });
  }

  private startupBatch: { a: { name: string; completionTitle?: string; completionText?: string; description: string; completionImage?: string }; rewardText: string }[] | null = [];

  private flushStartup(): void {
    const batch = this.startupBatch ?? [];
    this.startupBatch = null;
    if (batch.length <= 3) {
      for (const e of batch) goalPopup(this.ctx, e.a.completionTitle ?? `${e.a.name} — complete!`, e.a.completionText ?? e.a.description, e.a.completionImage, e.rewardText ? `Reward: ${e.rewardText}` : '');
      return;
    }
    const names = batch.map((e) => e.a.name).join(', ');
    goalPopup(this.ctx, `${batch.length} goals complete!`, `Your zoo already met these goals: ${names}.`, undefined, 'Their rewards have been added.');
  }

  /** World point above a tile in the zoo on screen, for floating numbers. */
  private anchor(i: number, j: number) {
    const o = this.ctx.view.world.objectAt(i, j);
    if (o) return this.ctx.view.objectAnchor(o);
    const p = P(i + 0.5, j + 0.5);
    return { x: p.x, y: p.y - 30 };
  }

  // ---------- HUD ----------

  private buildHud(): void {
    const coin = el('div', 'bar coinbar');
    coin.style.backgroundImage = `url(${IMG('coinbar.png')})`;
    coin.append(this.coinsEl);
    const gold = el('div', 'bar starbar');
    gold.style.backgroundImage = `url(${IMG('starbar.png')})`;
    gold.append(this.goldEl);
    const xp = el('div', 'bar xpbar');
    xp.style.backgroundImage = `url(${IMG('xpbar.png')})`;
    const track = el('div', 'xptrack');
    track.append(this.xpFill, this.xpText);
    xp.append(this.levelEl, track);
    const bonus = el('div', 'bonusbar');
    bonus.title = 'Bonus bar: keep collecting to fill it';
    const btrack = el('div', 'bonustrack');
    btrack.append(this.bonusFill);
    bonus.append(el('span', 'bonuslabel', 'Bonus'), btrack);
    this.gradeEl.onclick = () => openGrades(this.ctx);
    this.hud.style.backgroundImage = `url(${IMG('topbar.png')})`;
    this.hud.append(coin, gold, xp, bonus, this.gradeEl);
    this.root.append(this.hud);
  }

  private buildToolbar(): void {
    const btn = (img: string, title: string, fn: () => void, badge?: string) => {
      const b = button('tool', '', fn);
      b.title = title;
      b.style.backgroundImage = `url(${IMG(img)})`;
      // Badges sit in an unrotated wrapper (the button art itself is rotated).
      const wrap = el('div', 'toolwrap');
      wrap.append(b);
      if (badge) {
        const bd = el('div', 'badges');
        wrap.append(bd);
        this.badges.set(badge, bd);
      }
      this.toolbar.append(wrap);
    };
    this.collectBtn.title = 'Collect everything that is ready (Space)';
    this.collectBtn.style.backgroundImage = `url(${IMG('coin_45x45.png')})`;
    this.collectBtn.onclick = (e) => {
      e.stopPropagation();
      this.collectAll();
    };
    this.toolbar.append(this.collectBtn);
    btn('cs1-btnstore_0.png', 'Store', () => openStore(this.ctx));
    btn('nursery_0.png', 'Nursery', () => openNursery(this.ctx), 'nursery');
    btn('crossbreeding.png', 'Cross-breeding', () => openCrossbreed(this.ctx), 'cross');
    btn('zoostatus_0.png', 'Zoo grades & tickets', () => openGrades(this.ctx));
    btn('cs1-btnother_0.png', 'Other', () => openOther(this.ctx));
    this.root.append(this.toolbar);
    const home = button('homebtn', '', () => goHome(this.ctx));
    home.style.backgroundImage = `url(${IMG('homeicon.png')})`;
    home.title = 'Go home';
    this.visitBar.append(el('span', 'visitname'), home);
  }

  private buildProposeTab(): void {
    const b = (img: string, title: string, fn: () => void) => {
      const x = button('ptab', '', fn);
      x.title = title;
      x.style.backgroundImage = `url(${IMG(img)})`;
      return x;
    };
    this.proposeTab.style.backgroundImage = `url(${IMG('proposed_tab_bg.png')})`;
    this.proposeTab.append(
      b('proposed_tab_check_square.png', 'Place (Enter)', () => this.confirmGhost()),
      b('proposed_tab_cross_square.png', 'Cancel (Esc)', () => this.cancel()),
      b('proposed_tab_flip_square.png', 'Rotate (R)', () => this.rotateGhost()),
    );
  }

  refresh(): void {
    const { game } = this.ctx;
    const s = game.s;
    this.coinsEl.textContent = fmt(s.coins);
    this.goldEl.textContent = fmt(s.gold);
    const lv = game.level;
    const cur = xpForLevel(lv), next = xpForLevel(lv + 1);
    this.levelEl.textContent = String(lv);
    const frac = isFinite(next) ? (s.xp - cur) / (next - cur) : 1;
    this.xpFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    this.xpText.textContent = isFinite(next) ? `${fmt(s.xp)} / ${fmt(next)}` : fmt(s.xp);
    this.bonusFill.style.width = `${game.bonusMaxed() ? 100 : (s.bonus.progress / game.bonusTarget()) * 100}%`;
    this.bonusFill.classList.toggle('maxed', game.bonusMaxed());
    this.refreshHudSlow();
    this.refreshDock();
  }

  /** Toolbar badges: ready eggs (green), sick eggs (red), free nests (grey); Collect All count. */
  private refreshBadges(): void {
    const { game } = this.ctx;
    const now = Date.now();
    const count = (list: ({ end: number } | null)[], state: (n: never) => string) => {
      const c = { ready: 0, sick: 0, free: 0 };
      list.forEach((n) => {
        if (!n) c.free++;
        else if (state(n as never) === 'ready') c.ready++;
        else if (state(n as never) === 'sick') c.sick++;
      });
      return c;
    };
    const nests = count(Array.from({ length: game.s.breedSlots }, (_, i) => game.s.nests[i] ?? null), (n) => game.nestState(n, now));
    const cross = count(Array.from({ length: game.s.crossSlots }, (_, i) => game.s.crossNests[i] ?? null), (n) => game.crossState(n, now));
    const render = (key: string, c: { ready: number; sick: number; free: number }) => {
      const bd = this.badges.get(key);
      if (!bd) return;
      const html = [c.ready && `<span class="b ready" title="Ready to collect">${c.ready}</span>`, c.sick && `<span class="b sick" title="Sick">${c.sick}</span>`, c.free && `<span class="b free" title="Free">${c.free} free</span>`]
        .filter(Boolean)
        .join('');
      if (bd.innerHTML !== html) bd.innerHTML = html;
    };
    render('nursery', nests);
    render('cross', cross);
    const ready = game.readyObjects(now).length + (game.pendingRevenue(now) >= Math.max(5, game.s.ticketPrice * 10) ? 1 : 0);
    const label = ready ? String(ready) : '';
    if (this.collectBtn.textContent !== label) this.collectBtn.textContent = label;
    this.collectBtn.classList.toggle('idle', !ready);
  }

  private refreshHudSlow(): void {
    this.refreshBadges();
    const { game } = this.ctx;
    const g = gradeReport(game).grades.Overall;
    const html = `<b class="g${g}">${letter(g)}</b><span>${fmt(game.visitorsPerDay())} visitors/day</span>`;
    if (this.gradeEl.innerHTML !== html) this.gradeEl.innerHTML = html;
  }

  private dockKey = '';
  private refreshDock(): void {
    const goals = this.ctx.ach.visible().slice(0, 5);
    const key = goals.map((a) => a.id + a.requirements.map((r) => this.ctx.ach.progress(a, r).done).join()).join('|');
    if (key === this.dockKey) return;
    this.dockKey = key;
    this.dock.innerHTML = '';
    for (const a of goals) {
      const b = button('dockicon', `<img src="${iconUrl(a.icon)}">`, () => openGoal(this.ctx, a));
      b.title = a.name;
      this.dock.append(b);
    }
    const all = button('dockicon all', `<img src="${IMG('trophy-icon.png')}">`, () => openGoals(this.ctx));
    all.title = 'All goals';
    this.dock.append(all);
  }

  toast(text: string): void {
    const t = el('div', 'toast', escapeHtml(text));
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild!.remove();
    setTimeout(() => t.classList.add('out'), 2200);
    setTimeout(() => t.remove(), 2700);
  }

  // ---------- modes & placement ----------

  setMode(m: 'move' | 'sell'): void {
    this.ctx.panels.close(false);
    this.ctx.view.ghost = null;
    this.mode = m;
    this.refreshModeBar();
  }

  private refreshModeBar(): void {
    const g = this.ctx.view.ghost;
    let text = '';
    if (g?.moving) text = `Moving ${g.type.display}: tap a spot, then ✓`;
    else if (g?.fromInventory) text = `Placing ${g.type.display} from your inventory: tap a spot, then ✓`;
    else if (g?.type.smartFamily) text = `Painting ${g.type.display} (${priceHtml(g.type.price, g.type.gold)} each): click or drag`;
    else if (g) text = `Placing ${g.type.display}: tap a spot, then ✓`;
    else if (this.mode === 'move') text = 'Move: tap something to pick it up';
    else if (this.mode === 'sell') text = 'Sell: tap something to sell it';
    this.modeBar.classList.toggle('hidden', !text);
    if (this.modeBar.dataset.text !== text) {
      this.modeBar.dataset.text = text;
      this.modeBar.innerHTML = '';
      if (text) this.modeBar.append(el('span', '', text), button('plain', 'Done', () => this.cancel()));
    }
    this.positionProposeTab();
  }

  private positionProposeTab(): void {
    const g = this.ctx.view.ghost;
    const show = !!g?.proposed && !g.type.smartFamily;
    this.proposeTab.classList.toggle('hidden', !show);
    if (!show) return;
    const p = this.ctx.view.ghostScreenAnchor();
    if (!p) return;
    const scale = prefs.uiScale;
    this.proposeTab.style.left = `${Math.max(8, Math.min(window.innerWidth - 220 * scale, p.x - 102 * scale)) / scale}px`;
    this.proposeTab.style.top = `${Math.max(60, p.y - 120 * scale) / scale}px`;
  }

  cancelPlacing(): void {
    this.ctx.view.ghost = null;
    this.mode = 'none';
    this.refreshModeBar();
  }

  cancel(): void {
    this.cancelPlacing();
    this.ctx.panels.close(false);
  }

  private ghostAtCenter(t: ItemType, extra: Partial<Ghost>): void {
    const c = this.ctx.view.toWorld(window.innerWidth / 2, window.innerHeight / 2);
    const tile = tileAt(c.x, c.y);
    this.ctx.view.ghost = { type: t, i: tile.i, j: tile.j, flip: false, ...extra };
    this.refreshModeBar();
  }

  startPlacing(t: ItemType, fromInventory = false): void {
    this.ctx.panels.close(false);
    this.mode = 'none';
    this.ghostAtCenter(t, { fromInventory, proposed: !t.smartFamily });
  }

  startMoving(o: ZooObject): void {
    this.mode = 'none';
    this.ctx.view.ghost = { type: items.get(o.type)!, i: o.x, j: o.y, flip: o.flip, moving: o, proposed: true };
    this.refreshModeBar();
  }

  private rotateGhost(): void {
    const g = this.ctx.view.ghost;
    if (g) g.flip = !g.flip;
    this.refreshModeBar();
  }

  ghostChanged(): void {
    this.positionProposeTab();
  }

  /** Paths paint immediately; everything else is confirmed with ✓. */
  ghostPlaced(g: Ghost): void {
    const { game } = this.ctx;
    if (!game.canPlace(g.type, g.i, g.j, g.flip, g.moving)) return;
    const o = game.place(g.type, g.i, g.j, g.flip);
    if (!o || game.buyCheck(g.type)) this.cancelPlacing();
  }

  private confirmGhost(): void {
    const { game, view } = this.ctx;
    const g = view.ghost;
    if (!g) return;
    if (!game.canPlace(g.type, g.i, g.j, g.flip, g.moving)) return this.toast("Can't put it there");
    if (g.moving) {
      game.move(g.moving, g.i, g.j, g.flip);
      this.cancelPlacing();
      return;
    }
    if (g.fromInventory) {
      game.placeFromInventory(g.type, g.i, g.j, g.flip);
      this.cancelPlacing();
      return;
    }
    const o = game.place(g.type, g.i, g.j, g.flip);
    if (!o) return;
    // Small decorations keep placing; habitats and buildings place once.
    const repeat = g.type.category === 'decoration' && g.type.w * g.type.h <= 2 && !game.buyCheck(g.type);
    if (repeat) g.proposed = false;
    else this.cancelPlacing();
    this.refreshModeBar();
  }

  // ---------- taps ----------

  objectTapped(o: ZooObject): void {
    const { game, view } = this.ctx;
    const t = items.get(o.type)!;
    if (view.visiting) return helpNeighbor(this.ctx, o.id);
    game.bump(`click:${t.name}`);
    if (this.mode === 'move') {
      if (t.rowType === 'Trash' || /FrontGate|Dock/.test(t.name)) return this.toast("That can't be moved");
      return this.startMoving(o);
    }
    if (this.mode === 'sell') {
      if (t.rowType === 'Trash' || /FrontGate|Dock/.test(t.name)) return this.toast("That can't be sold");
      return this.ctx.panels.confirm(`Sell ${escapeHtml(t.display)}${(o.count ?? 1) > 1 ? ` (×${o.count})` : ''} for ${fmt(t.sellPrice * (o.count ?? 1))} coins?`, () => game.sell(o));
    }
    if (t.rowType === 'Trash') return game.cleanTrash(o, o.x, o.y);
    // Finished eggs can be collected from the habitat too.
    const nest = game.nestFor(o);
    if (nest && game.nestState(nest) === 'ready') {
      game.completeNest(game.s.nests.indexOf(nest));
      return;
    }
    if (game.isReady(o)) {
      view.coinBurst(o);
      game.harvest(o);
      return;
    }
    if (game.hasExclamation(o)) {
      return openSidegrades(this.ctx, o);
    }
    if (t.category !== 'path' && !/FrontGate/.test(t.name)) openObject(this.ctx, o);
    game.save();
  }

  trashHovered(o: ZooObject): void {
    // Only at home and outside move/sell mode; the neighbor's zoo keeps tap-to-help.
    if (this.ctx.view.visiting || this.mode !== 'none' || this.ctx.panels.isOpen) return;
    this.ctx.game.cleanTrash(o, o.x, o.y);
  }

  gateTapped(): void {
    if (this.ctx.view.visiting) return;
    if (!this.ctx.game.collectRevenue()) openGrades(this.ctx);
  }

  signTapped(): void {
    openLand(this.ctx);
  }

  setVisiting(name: string | null): void {
    this.visitBar.classList.toggle('hidden', !name);
    this.toolbar.classList.toggle('hidden', !!name);
    this.dock.classList.toggle('hidden', !!name);
    (this.visitBar.querySelector('.visitname') as HTMLElement).textContent = name ? `Visiting ${name}'s zoo — tap animals and trash to help out` : '';
  }

  // ---------- popups ----------

  private levelUp(level: number, coins: number, gold: number): void {
    this.ctx.view.fireworks();
    const unlocked = [...items.values()].filter((i) => this.ctx.game.isAvailable(i) && i.level === level && i.price > 0);
    this.ctx.panels.enqueue(() =>
      this.ctx.panels.open('info levelup', (p) => {
        const banner = el('div', 'congrats');
        banner.style.backgroundImage = `url(${IMG('congratulations.png')})`;
        p.append(banner, el('h2', '', `Level ${level}!`));
        const body = el('div', 'body');
        body.innerHTML = `<p>Reward: ${priceHtml(coins, false)} ${gold ? priceHtml(gold, true) : ''}</p>`;
        if (unlocked.length) {
          const row = el('div', 'unlocks');
          for (const it of unlocked.slice(0, 10)) {
            const d = el('div', `thumb ${it.missingArt ? 'blank' : ''}`);
            d.title = it.display;
            d.style.backgroundImage = `url(${thumbUrl(it)})`;
            row.append(d);
          }
          body.append(el('p', '', `${unlocked.length} new thing${unlocked.length > 1 ? 's' : ''} in the store:`), row);
        }
        body.append(button('btn', 'Great!', () => this.ctx.panels.close()));
        p.append(body);
      }),
    );
  }

  private bonus(coins: number): void {
    const b = el('div', 'superbanner');
    b.style.backgroundImage = `url(${IMG('Super.png')})`;
    b.append(el('span', '', `Bonus +${fmt(coins)}`));
    this.root.append(b);
    setTimeout(() => b.classList.add('out'), 1800);
    setTimeout(() => b.remove(), 2400);
  }

  /** In-game toast always; a desktop notification too when the window is in the background. */
  private notify(state: 'ready' | 'sick', name: string, cross: boolean): void {
    const text =
      state === 'sick'
        ? `Your ${name} egg got sick! Revive it in the ${cross ? 'Cross-Breeding lab' : 'Nursery'}.`
        : cross
          ? `Your crossbred ${name} has hatched! Collect it in the Cross-Breeding lab.`
          : (notificationTexts.get('Breeding-finished') ?? 'Your baby %@ has hatched! Come collect it!').replace('%@', name);
    this.toast(text);
    this.refreshBadges();
    if (document.hasFocus() || !('Notification' in window)) return;
    if (Notification.permission === 'granted') new Notification('Tap Zoo', { body: text });
    else if (Notification.permission === 'default') Notification.requestPermission();
  }

  // ---------- hover tooltips ----------

  hovered(o: ZooObject | null, at: { x: number; y: number }): void {
    this.hoveredObj = o;
    this.hoverAt = at;
    this.refreshTooltip();
  }

  private refreshTooltip(): void {
    const { game, view, panels } = this.ctx;
    const o = this.hoveredObj;
    const t = o && items.get(o.type);
    if (!o || !t || view.ghost || panels.isOpen || t.rowType === 'Trash' || !view.world.s.objects.includes(o)) {
      this.tooltip.classList.add('hidden');
      return;
    }
    const world = view.world;
    const now = Date.now();
    const rows: string[] = [`<b>${escapeHtml(t.display)}</b>`];
    if (t.category === 'animal') rows.push(`${o.count ?? 1} of ${t.maxCount} animals`);
    if (world.isSick(o, now)) rows.push('<span class="bad">Sick — revive it in the Nursery</span>');
    else if (t.harvestCoins) {
      const left = world.readyAt(o) - now;
      rows.push(left > 0 ? `${priceHtml(t.harvestCoins * (o.count ?? 1), false)} in ${duration(left)}` : `<span class="good">Ready: ${priceHtml(t.harvestCoins * (o.count ?? 1), false)}</span>`);
    }
    const nest = world.nestFor(o);
    if (nest) {
      const st = world.nestState(nest, now);
      rows.push(st === 'incubating' ? `Egg hatches in ${duration(nest.end - now)}` : st === 'ready' ? '<span class="good">Egg ready — tap to collect</span>' : '');
    }
    if (t.category === 'animal' && !nest && (o.count ?? 1) >= 2 && (o.count ?? 1) < t.maxCount && t.breedable) rows.push('<small>Pair ready to breed</small>');
    if (/FrontGate/.test(t.name) && !view.visiting) rows.push(`Tickets waiting: ${priceHtml(game.pendingRevenue(now), false)}`);
    const html = rows.filter(Boolean).join('<br>');
    if (this.tooltip.innerHTML !== html) this.tooltip.innerHTML = html;
    this.tooltip.classList.remove('hidden');
    const scale = prefs.uiScale;
    this.tooltip.style.left = `${(this.hoverAt.x + 16) / scale}px`;
    this.tooltip.style.top = `${(this.hoverAt.y + 16) / scale}px`;
  }

  private dailyDialog(): void {
    const { game, panels } = this.ctx;
    const d = game.dailyAvailable();
    if (!d) return;
    panels.open('info daily', (p) => {
      p.append(el('h2', '', 'Daily Bonus'));
      const row = el('div', 'days');
      for (let i = 1; i <= 5; i++) {
        const day = el('div', `day ${i === d.day ? 'on' : i < d.day ? 'done' : ''}`);
        day.style.backgroundImage = `url(${IMG(`day${i}_${i < d.day ? 'sm' : 'lg'}.png`)})`;
        row.append(day);
      }
      const body = el('div', 'body', `<p>Day ${d.day}: ${priceHtml(d.coins, false)}<br><small>Come back tomorrow for a bigger bonus.</small></p>`);
      body.append(
        button('btn', 'Collect', () => {
          game.claimDaily();
          panels.close();
        }),
      );
      p.append(row, body);
    });
  }

  /** The theme loop; browsers only allow playback after the first user gesture. */
  syncMusic(): void {
    if (!this.music) {
      this.music = new Audio('./game/sound/tzl.wav');
      this.music.loop = true;
      this.music.volume = prefs.musicVolume;
    }
    if (this.ctx.game.s.music) this.music.play().catch(() => {});
    else this.music.pause();
  }
}
