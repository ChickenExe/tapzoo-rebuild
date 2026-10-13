// Zoo Grades + Ticket Price (GradesPanel, TicketPricePanel), Land (LandPanel), the Other menu
// (OtherToolsView), settings and save/load (SaveLoadView), and visiting the neighbor.
import { items, neighbor } from '../data';
import { Game, ZOO_DAY } from '../game';
import { gradeReport, letter } from '../grades';
import type { Ctx } from './index';
import { button, duration, el, fmt, IMG, priceHtml } from './dom';
import { openStore } from './store';
import { backupsAreFiles, listBackups, openBackupFolder, readBackup } from '../host';
import { prefs, savePrefs } from '../prefs';

export function openGrades(ctx: Ctx): void {
  const { game, panels } = ctx;
  ctx.ui.cancelPlacing();
  panels.open(
    'info grades',
    (p) => {
      p.append(el('h2', '', 'Zoo Grades'), el('div', 'gradebody'));
    },
    (p) => {
      const body = p.querySelector('.gradebody')!;
      const r = gradeReport(game);
      const visitors = game.visitorsPerDay();
      const rangers = game.countOfCategory('staff');
      const row = (name: string, g: number, detail: string) =>
        `<tr><td>${name}</td><td class="letter g${Math.round(g)}">${letter(g)}</td><td><small>${detail}</small></td></tr>`;
      const html = `<table class="gradetable">
        ${row('Animals', r.grades.Animal, `value ${fmt(r.values.animals)} / ${fmt(r.targets.animals)}`)}
        ${row('Rangers', r.grades.Ranger, `${rangers} hired / ${r.rangersNeeded} needed`)}
        ${row('Restaurants', r.grades.Restaurant, `value ${fmt(r.values.food)} / ${fmt(r.targets.food)}`)}
        ${row('Facilities', r.grades.Facilities, `value ${fmt(r.values.facilities)} / ${fmt(r.targets.facilities)}`)}
        ${row('Shopping', r.grades.Shopping, `value ${fmt(r.values.shops)} / ${fmt(r.targets.shops)}`)}
        ${row('<b>Overall</b>', r.grades.Overall, 'Better grades bring more visitors')}
      </table>
      <h3>Tickets</h3>
      <div class="ticket"><span>Ticket price</span><b>${priceHtml(game.s.ticketPrice, false)}</b></div>
      <p>${fmt(visitors)} visitors a day · about ${priceHtml(visitors * game.s.ticketPrice, false)} per zoo day (${duration(ZOO_DAY)})<br>
      <small>Visitors think ${priceHtml(game.fairPrice(), false)} is fair. Charge too much and they stay home.</small></p>
      <p>Waiting at the gate: ${priceHtml(game.pendingRevenue(), false)}</p>`;
      if (body.getAttribute('data-html') === html) return;
      body.setAttribute('data-html', html);
      body.innerHTML = html;
      const actions = el('div', 'actions');
      actions.append(
        button('btn small', '−', () => game.setTicketPrice(game.s.ticketPrice - 1)),
        button('btn small', '+', () => game.setTicketPrice(game.s.ticketPrice + 1)),
        button('btn', 'Collect ticket money', () => {
          if (!game.collectRevenue()) ctx.ui.toast('No ticket money yet');
        }),
      );
      body.append(actions);
    },
  );
}

export function openLand(ctx: Ctx): void {
  const { game, panels } = ctx;
  ctx.ui.cancelPlacing();
  panels.open(
    'info land',
    (p) => {
      const pic = el('div', 'storyimg');
      pic.style.backgroundImage = `url(${IMG('land_expansion.png')})`;
      p.append(el('h2', '', 'Buy Land'), pic, el('div', 'body'));
    },
    (p) => {
      const body = p.querySelector('.body')!;
      const m = game.nextMap();
      const s = game.s;
      let html = `<p>Your zoo is ${game.map.w}×${game.map.h}.</p>`;
      if (s.landBuildUntil) html += `<p>Clearing new land: <b>${duration(s.landBuildUntil - Date.now())}</b></p>`;
      else if (m) html += `<p>Expand to ${m.w}×${m.h} for ${priceHtml(m.cost, false)}<br><small>Takes ${duration(m.buildMinutes * 60000) || 'no time'} to clear</small></p>`;
      else html += '<p>Your zoo is as big as it gets!</p>';
      if (body.getAttribute('data-html') === html) return;
      body.setAttribute('data-html', html);
      body.innerHTML = html;
      const actions = el('div', 'actions');
      if (s.landBuildUntil && m) {
        const cost = game.expediteCost(m.expediteGold, s.landBuildUntil - m.buildMinutes * 60000, s.landBuildUntil);
        actions.append(button('btn', `Finish now ${priceHtml(cost, true)}`, () => game.expediteLand()));
      } else if (m) actions.append(button('btn', 'Buy land', () => game.buyLand()));
      body.append(actions);
    },
  );
}

export function openOther(ctx: Ctx): void {
  const { panels } = ctx;
  ctx.ui.cancelPlacing();
  panels.open('info other', (p) => {
    p.append(el('h2', '', 'Other'));
    const grid = el('div', 'othergrid');
    const tool = (img: string, label: string, fn: () => void) => {
      const b = button('tool', '', () => {
        panels.close(false);
        fn();
      });
      b.title = label;
      b.style.backgroundImage = `url(${IMG(img)})`;
      grid.append(b);
    };
    tool('movetool_0.png', 'Move', () => ctx.ui.setMode('move'));
    tool('sell_0.png', 'Sell', () => ctx.ui.setMode('sell'));
    tool('ownedanimals_0.png', 'Owned animals', () => openStore(ctx, 'inventory'));
    tool('land_0.png', 'Land', () => openLand(ctx));
    if (neighbor) tool('visit_neighbors.png', 'Visit neighbor', () => visitNeighbor(ctx));
    tool('saveload_0.png', 'Save / load', () => openSaveLoad(ctx));
    tool('cs1-btnother_0.png', 'Settings', () => openSettings(ctx));
    p.append(grid);
  });
}

function openSaveLoad(ctx: Ctx): void {
  const { game, panels } = ctx;
  const restore = (text: string | null, label: string) => {
    if (!text) return ctx.ui.toast("Couldn't read that save");
    panels.confirm(`Replace your current zoo with ${label}?`, () => {
      ctx.ui.toast(game.importSave(text) ? 'Zoo loaded!' : "That file isn't a Tap Zoo save");
      ctx.view.centerCamera();
    });
  };
  panels.open('info saveload', (p) => {
    p.append(el('h2', '', 'Save / Load'));
    const body = el('div', 'body', '<p>Export your zoo to a file to back it up or move it to another computer.</p>');
    const file = el('input') as HTMLInputElement;
    file.type = 'file';
    file.accept = '.json,application/json';
    file.style.display = 'none';
    file.onchange = async () => {
      const f = file.files?.[0];
      if (f) restore(await f.text(), 'this save');
    };
    const actions = el('div', 'actions');
    actions.append(
      button('btn', 'Export save', () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([game.exportSave()], { type: 'application/json' }));
        a.download = `tapzoo-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }),
      button('btn ghost', 'Import save…', () => file.click()),
    );
    body.append(actions, file);
    // Automatic daily backups.
    const list = el('div', 'backups', '<h3>Automatic backups</h3><p class="fine">Loading…</p>');
    body.append(list);
    listBackups().then((bs) => {
      list.innerHTML = `<h3>Automatic backups</h3><p class="fine">A copy of your zoo is saved every day${backupsAreFiles ? ' (the last 14 days are kept)' : ''}.</p>`;
      for (const b of bs) {
        const row = el('div', 'backuprow', `<span>${new Date(`${b.date}T12:00:00`).toDateString()}</span>`);
        row.append(button('btn small ghost', 'Restore', async () => restore(await readBackup(b.name), `the backup from ${b.date}`)));
        list.append(row);
      }
      if (!bs.length) list.append(el('p', 'fine', 'No backups yet — the first one is made a few seconds after the game starts.'));
      if (backupsAreFiles) list.append(button('btn small ghost', 'Show backup folder', () => openBackupFolder()));
    });
    p.append(body);
  });
}

export function openSettings(ctx: Ctx): void {
  const { game, panels } = ctx;
  panels.open('info settings', (p) => {
    p.append(el('h2', '', 'Settings'));
    const body = el('div', 'body');
    const row = (label: string, control: HTMLElement) => {
      const r = el('label', 'setrow', `<span>${label}</span>`);
      r.append(control);
      body.append(r);
    };
    const music = el('input') as HTMLInputElement;
    music.type = 'checkbox';
    music.checked = game.s.music;
    music.onchange = () => {
      game.s.music = music.checked;
      game.save();
      ctx.ui.syncMusic();
    };
    row('Music', music);
    const vol = el('input') as HTMLInputElement;
    vol.type = 'range';
    vol.min = '0';
    vol.max = '1';
    vol.step = '0.05';
    vol.value = String(prefs.musicVolume);
    vol.oninput = () => {
      prefs.musicVolume = Number(vol.value);
      savePrefs();
      ctx.ui.applyPrefs();
    };
    row('Music volume', vol);
    const scale = el('select') as HTMLSelectElement;
    for (const v of [0.8, 0.9, 1, 1.15, 1.3, 1.5]) scale.append(new Option(`${Math.round(v * 100)}%`, String(v), false, v === prefs.uiScale));
    scale.onchange = () => {
      prefs.uiScale = Number(scale.value);
      savePrefs();
      ctx.ui.applyPrefs();
    };
    row('Interface size', scale);
    const timers = el('input') as HTMLInputElement;
    timers.type = 'checkbox';
    timers.checked = prefs.showTimers;
    timers.onchange = () => {
      prefs.showTimers = timers.checked;
      savePrefs();
    };
    row('Show countdowns under habitats', timers);
    body.insertAdjacentHTML(
      'beforeend',
      `<p class="fine">Drag to look around, scroll or pinch to zoom. Space collects everything that's ready. R rotates while placing, Enter confirms, G toggles the tile grid, Esc cancels.</p>
      <p class="fine">A rebuild of Tap Zoo 2.5.7 by Pocket Gems, using the art and data from your copy of the game. Items whose art was only on Pocket Gems' servers appear as blank squares; drop a PNG named after the item into custom-art/ to give it art.</p>`,
    );
    const actions = el('div', 'actions');
    actions.append(
      button('btn danger', 'Start a new zoo', () =>
        panels.confirm('Erase this zoo and start over?', () => {
          game.reset();
          ctx.view.centerCamera();
        }),
      ),
    );
    body.append(actions);
    p.append(body);
  });
}

// ---------- neighbor (NeighborSelectPanel; the bundled demo zoo, hugeZoo.db) ----------

let neighborWorld: Game | null = null;
const HELPS_PER_DAY = 5;

export function visitNeighbor(ctx: Ctx): void {
  if (!neighbor) return;
  if (!neighborWorld) {
    const g = new Game(undefined, false);
    const s = g.fresh();
    s.xp = neighbor.xp;
    s.mapIndex = neighbor.mapIndex;
    s.objects = neighbor.objects
      .filter((o) => items.has(o.name))
      .map((o, k) => ({ id: k + 1, type: o.name, x: o.x, y: o.y, flip: false, count: items.get(o.name)!.category === 'animal' ? o.count : undefined, cycleStart: 0 }));
    neighborWorld = new Game(s, false);
  }
  ctx.game.bump('DidVisitNeighbor');
  ctx.game.tutorialKey('visitNeighbor');
  ctx.view.setWorld(neighborWorld);
  ctx.ui.setVisiting(neighbor.name);
}

/** Tapping things at the neighbor's zoo helps them out and earns a little. */
export function helpNeighbor(ctx: Ctx, objId: number): void {
  const { game } = ctx;
  const today = new Date().toDateString();
  if (game.s.neighborDay !== today) {
    game.s.neighborDay = today;
    game.s.neighborHelped = [];
  }
  const o = neighborWorld?.byId(objId);
  if (!o) return;
  const t = items.get(o.type)!;
  if (!t.harvestCoins && t.rowType !== 'Trash') return;
  if (game.s.neighborHelped.includes(objId)) return ctx.ui.toast('You already helped here today');
  if (game.s.neighborHelped.length >= HELPS_PER_DAY) return ctx.ui.toast(`You can help ${HELPS_PER_DAY} times a day`);
  game.s.neighborHelped.push(objId);
  // Scaled to your own level: Sally's late-game animals would otherwise pay a fortune.
  const coins = 20 + game.level * 15;
  game.addCoins(coins, o.x, o.y);
  game.addXp(1, o.x, o.y);
  game.tutorialKey('lookAroundNeighbor');
  game.save();
  game.emit({ kind: 'changed' });
  ctx.ui.toast(`Thanks for helping! +${fmt(coins)} coins`);
}

export function goHome(ctx: Ctx): void {
  ctx.view.setWorld(ctx.game);
  ctx.ui.setVisiting(null);
}
