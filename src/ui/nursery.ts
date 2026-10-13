// Nursery (BreedingPanel / BreedingSlotView): nests for breeding pairs, plus the
// Cross-Breeding panel (CrossBreedingPanel with left/right ingredient lists).
import { breedingSlotCosts, crossParents, crossRecipes, crossSlotCosts, items, ItemType, recipeFor, thumbUrl } from '../data';
import type { Ctx } from './index';
import { button, duration, el, fmt, IMG, priceHtml } from './dom';

function nestImg(name: string): HTMLElement {
  const d = el('div', 'nestimg');
  d.style.backgroundImage = `url(${IMG(name)})`;
  return d;
}

function thumb(it: ItemType, cls = 'thumb'): HTMLElement {
  const t = el('div', `${cls} ${it.missingArt ? 'blank' : ''}`);
  const url = thumbUrl(it);
  if (url) t.style.backgroundImage = `url(${url})`;
  return t;
}

export function openNursery(ctx: Ctx): void {
  const { game, panels } = ctx;
  ctx.ui.cancelPlacing();
  panels.open(
    'nursery',
    (p) => {
      const banner = el('div', 'banner');
      banner.style.backgroundImage = `url(${IMG('nursery.png')})`;
      p.append(banner, el('div', 'nests'));
    },
    (p) => {
      const box = p.querySelector('.nests')!;
      const now = Date.now();
      const key = JSON.stringify([game.s.breedSlots, game.s.nests.map((n) => n && [n.cageId, game.nestState(n, now)]), Math.floor(now / 1000)]);
      if (box.getAttribute('data-k') === key) return;
      box.setAttribute('data-k', key);
      box.innerHTML = '';
      for (let i = 0; i < breedingSlotCosts.length; i++) {
        const slot = el('div', 'nest');
        const n = game.s.nests[i];
        const cage = n ? game.byId(n.cageId) : undefined;
        if (i >= game.s.breedSlots) {
          slot.append(nestImg('locknest2.png'));
          if (i === game.s.breedSlots) {
            const c = breedingSlotCosts[i];
            slot.append(el('div', 'unlock', `<img src="${IMG('tapToUnlock.png')}">`), el('div', 'cost', priceHtml(c.cost, c.gold)));
            slot.onclick = () => game.buySlot();
            slot.classList.add('clickable');
          } else slot.classList.add('dim');
        } else if (!n || !cage) {
          slot.append(nestImg('emptynest2.png'), el('div', 'label', 'Tap to select'));
          slot.classList.add('clickable');
          slot.onclick = () => chooseBreeder(ctx, i);
        } else {
          const t = items.get(cage.type)!;
          const st = game.nestState(n, now);
          slot.append(nestImg(st === 'sick' ? 'Rotten_EggNestB.png' : 'eggnest2.png'), el('div', 'label', t.display));
          if (st === 'incubating') {
            slot.append(el('div', 'timer', duration(n.end - now)));
            slot.append(button('btn small', `Finish ${priceHtml(game.expediteCost(t.expediteGold, n.start, n.end), true)}`, () => game.expediteNest(i)));
          } else if (st === 'ready') {
            slot.append(el('div', 'complete', `<img src="${IMG('Tap_to_Complete_.png')}">`));
            slot.classList.add('clickable', 'glow');
            slot.onclick = () => game.completeNest(i);
          } else {
            slot.append(el('div', 'sick', 'Sick!'));
            const row = el('div', 'row');
            row.append(
              button('btn small', `Revive ${priceHtml(t.reviveCost, true)}`, () => game.reviveNest(i)),
              button('btn small ghost', 'Discard', () => panels.confirm(`Throw away the ${t.display} egg?`, () => game.discardNest(i))),
            );
            slot.append(row);
          }
        }
        box.append(slot);
      }
      const help = el('p', 'hint', 'Breed a pair to add babies to a habitat (up to 4). Collect each egg once it hatches — if it waits too long the baby gets sick.');
      box.append(help);
    },
  );
}

function chooseBreeder(ctx: Ctx, slot: number): void {
  const { game, panels } = ctx;
  panels.open('store picker', (p) => {
    p.append(el('h2', '', 'Choose a pair to breed'));
    const grid = el('div', 'grid');
    const list = game.breedable();
    for (const o of list) {
      const t = items.get(o.type)!;
      const c = el('button', `card ${game.canAfford(t.breedCost, t.breedGold) ? '' : 'cant'}`);
      c.innerHTML = `<div class="name">${t.display}</div>`;
      c.append(thumb(t));
      c.insertAdjacentHTML('beforeend', `<div class="stat">${o.count} of ${t.maxCount} · ${duration(t.breedMs)}</div>${priceHtml(t.breedCost, t.breedGold)}`);
      c.onclick = () => {
        if (game.breed(o, slot)) openNursery(ctx);
      };
      grid.append(c);
    }
    if (!list.length) grid.append(el('p', 'empty', 'No pairs ready to breed. Buy a second animal of a species to make a pair.'));
    p.append(grid, button('btn ghost back', '‹ Back', () => openNursery(ctx)));
  });
}

// ---------- crossbreeding ----------

export function openCrossbreed(ctx: Ctx, left?: string, right?: string, slot = 0): void {
  const { game, panels } = ctx;
  ctx.ui.cancelPlacing();
  const parents = crossParents();
  panels.open(
    'cross',
    (p) => {
      const top = el('div', 'banner');
      top.style.backgroundImage = `url(${IMG('cross-breedingtopbar.png')})`;
      p.append(top);
      // Slot tabs.
      const slots = el('div', 'tabs');
      for (let i = 0; i < crossSlotCosts.length; i++) {
        const unlocked = i < game.s.crossSlots;
        const busy = game.s.crossNests[i];
        if (!unlocked && i > game.s.crossSlots) break;
        const label = unlocked ? `Slot ${i + 1}${busy ? ' 🥚' : ''}` : `🔒 Unlock slot ${i + 1} ${priceHtml(crossSlotCosts[i].cost, crossSlotCosts[i].gold)}`;
        slots.append(
          button(i === slot ? 'tab on' : 'tab', label, () => {
            if (!unlocked) {
              if (game.buyCrossSlot()) openCrossbreed(ctx, left, right, i);
            } else openCrossbreed(ctx, left, right, i);
          }),
        );
      }
      p.append(slots);

      const nest = game.s.crossNests[slot];
      const body = el('div', 'crossbody');
      p.append(body);
      if (slot >= game.s.crossSlots) {
        body.append(el('p', 'empty', 'Unlock a crossbreeding slot to start mixing species.'));
        return;
      }
      if (nest) {
        body.append(nestView(ctx, slot));
        return;
      }
      const owned = (n: string) => !!game.habitatOf(n);
      const leftList = [...parents].filter(owned).map((n) => items.get(n)!).sort((a, b) => a.display.localeCompare(b.display));
      const partners = left
        ? crossRecipes.filter((r) => r.a === left || r.b === left).map((r) => (r.a === left ? r.b : r.a))
        : [];
      const col = (title: string, list: ItemType[], pick: (n: string) => void, chosen?: string, dimUnowned = false) => {
        const c = el('div', 'crosscol');
        c.append(el('h3', '', title));
        const scroller = el('div', 'crosslist');
        for (const it of list) {
          const row = el('button', `crossrow ${it.name === chosen ? 'on' : ''} ${dimUnowned && !owned(it.name) ? 'cant' : ''}`);
          row.append(thumb(it, 'mini'));
          row.append(el('span', '', `${it.display}${dimUnowned && !owned(it.name) ? ' <small>(not owned)</small>' : ''}`));
          row.onclick = () => pick(it.name);
          scroller.append(row);
        }
        if (!list.length) scroller.append(el('p', 'empty', title === 'First animal' ? 'Get animals with the Cross-Breedable badge to start.' : 'Pick a first animal.'));
        c.append(scroller);
        return c;
      };
      const leftCol = col('First animal', leftList, (n) => openCrossbreed(ctx, n, undefined, slot), left);
      const rightCol = col('Second animal', [...new Set(partners)].map((n) => items.get(n)!), (n) => openCrossbreed(ctx, left, n, slot), right, true);
      const center = el('div', 'crosscenter');
      const recipe = left && right ? recipeFor(left, right) : undefined;
      if (recipe) {
        const res = items.get(recipe.result)!;
        const known = game.s.discovered.includes(res.name);
        const pic = known ? thumb(res, 'thumb big') : el('div', 'thumb big mystery');
        if (!known) pic.style.backgroundImage = `url(${IMG('question-mark.png')})`;
        center.append(pic, el('div', 'name', known ? res.display : 'Mystery animal'));
        center.append(el('div', 'stat', `Takes ${duration(res.breedMs)}`));
        const why = game.crossCheck(left!, right!, slot);
        const go = button(`btn ${why ? 'disabled' : ''}`, `Cross-breed ${priceHtml(res.breedCost, res.breedGold)}`, () => {
          if (game.crossbreed(left!, right!, slot)) openCrossbreed(ctx, undefined, undefined, slot);
        });
        center.append(go);
        if (why) center.append(el('div', 'why', why));
      } else {
        const tip = el('div', 'tapto');
        tip.style.backgroundImage = `url(${IMG('Taptocross-breed.png')})`;
        center.append(tip);
      }
      body.append(leftCol, center, rightCol);
    },
    (p) => {
      // Live timer for a busy slot.
      const t = p.querySelector('.crossnest .timer');
      const n = game.s.crossNests[slot];
      if (t && n) t.textContent = duration(n.end - Date.now());
      const st = n && game.crossState(n);
      const box = p.querySelector('.crossnest');
      if (box && st && box.getAttribute('data-state') !== st) openCrossbreed(ctx, left, right, slot);
    },
  );
}

function nestView(ctx: Ctx, slot: number): HTMLElement {
  const { game, panels } = ctx;
  const n = game.s.crossNests[slot]!;
  const res = items.get(n.result)!;
  const st = game.crossState(n);
  const box = el('div', 'crossnest');
  box.setAttribute('data-state', st);
  const a = items.get(n.a)!, b = items.get(n.b)!;
  box.append(el('div', 'parents', `${a.display} × ${b.display}`));
  box.append(nestImg(st === 'sick' ? 'Rotten_EggNestB.png' : 'eggnest2.png'));
  const known = game.s.discovered.includes(res.name);
  box.append(el('div', 'name', known ? res.display : 'Mystery animal'));
  if (st === 'incubating') {
    box.append(el('div', 'timer', duration(n.end - Date.now())));
    box.append(button('btn', `Finish now ${priceHtml(game.expediteCost(res.expediteGold, n.start, n.end), true)}`, () => game.expediteCross(slot) && openCrossbreed(ctx, undefined, undefined, slot)));
  } else if (st === 'ready') {
    box.append(button('btn', 'Tap to complete', () => game.completeCross(slot) && panels.close()));
  } else {
    box.append(el('div', 'sick', 'Sick!'));
    box.append(
      button('btn', `Revive ${priceHtml(res.reviveCost, true)}`, () => game.reviveCross(slot) && panels.close()),
      button('btn ghost', 'Discard', () => panels.confirm('Throw away this egg?', () => game.discardCross(slot))),
    );
  }
  box.append(el('p', 'hint', `Coins earned: ${fmt(res.harvestCoins)} every ${duration(Math.max(1, res.growMinutes) * 60000)} once placed.`));
  return box;
}
