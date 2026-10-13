// Info panel for anything tapped in the zoo, and the upgrade (sidegrade) picker.
import { items, thumbUrl } from '../data';
import type { ZooObject } from '../game';
import type { Ctx } from './index';
import { button, duration, el, escapeHtml, IMG, priceHtml } from './dom';
import { openNursery } from './nursery';

export function openObject(ctx: Ctx, o: ZooObject): void {
  const { game, panels } = ctx;
  const t = items.get(o.type)!;
  panels.open(
    'info',
    (p) => {
      const thumb = el('div', `thumb big ${t.missingArt ? 'blank' : ''}`);
      thumb.style.backgroundImage = `url(${thumbUrl(t)})`;
      p.append(el('h2', '', escapeHtml(t.display)), thumb, el('div', 'body'));
    },
    (p) => {
      const body = p.querySelector('.body')!;
      const now = Date.now();
      const count = o.count ?? 1;
      const left = game.readyAt(o) - now;
      const nest = game.nestFor(o);
      let html = t.category === 'animal' ? `<p>Animals: <b>${count}</b> / ${t.maxCount}${t.missingArt ? '<br><small>(art not included in this copy of the game)</small>' : ''}</p>` : '';
      if (t.tipText) html += `<p>${escapeHtml(t.tipText)}</p>`;
      if (t.harvestCoins) {
        html += `<p>Earns ${priceHtml(t.harvestCoins * count, false)} every ${duration(game.cycleMs(t))}<br>`;
        html += `${game.isSick(o, now) ? '<b>Sick! Revive it in the Nursery.</b>' : left > 0 ? `Next collection in <b>${duration(left)}</b>` : '<b>Ready to collect!</b>'}</p>`;
      } else if (t.category !== 'animal') html += '<p>Makes your zoo a nicer place to visit.</p>';
      if (nest) {
        const st = game.nestState(nest, now);
        html += `<p>${st === 'incubating' ? `A baby is on the way: <b>${duration(nest.end - now)}</b>` : st === 'ready' ? '<b>An egg is ready in the Nursery!</b>' : '<b>The egg in the Nursery is sick!</b>'}</p>`;
      }
      if (body.getAttribute('data-html') === html) return;
      body.setAttribute('data-html', html);
      body.innerHTML = html;
      const actions = el('div', 'actions');
      if (t.category === 'animal' && count < t.maxOwned) {
        actions.append(button('btn', `Buy a mate ${priceHtml(t.price, t.gold)}`, () => game.addAnimal(t)));
      } else if (t.category === 'animal' && t.breedable && count < t.maxCount) {
        if (nest) actions.append(button('btn', 'Open Nursery', () => openNursery(ctx)));
        else
          actions.append(
            button('btn', `Breed ${priceHtml(t.breedCost, t.breedGold)}`, () => {
              const why = game.breedCheck(o);
              if (why) {
                ctx.ui.toast(why);
                if (/Nursery|nest/.test(why)) openNursery(ctx);
                return;
              }
              game.breed(o);
            }),
          );
      }
      if (game.sidegrades(o).length) {
        const up = button('btn', `<img class="inline" src="${IMG('upgrade_icon.png')}"> Upgrade`, () => openSidegrades(ctx, o));
        actions.append(up);
      }
      if (t.category !== 'path' && !/Dock/.test(t.name)) {
        actions.append(
          button('btn', 'Move', () => {
            panels.close(false);
            ctx.ui.startMoving(o);
          }),
          button('btn ghost', `Sell ${priceHtml(t.sellPrice * count, false)}`, () => panels.confirm(`Sell ${escapeHtml(t.display)} for ${t.sellPrice * count} coins?`, () => game.sell(o))),
        );
      }
      body.append(actions);
    },
  );
}

export function openSidegrades(ctx: Ctx, o: ZooObject): void {
  const { game, panels } = ctx;
  const from = items.get(o.type)!;
  panels.open('store picker', (p) => {
    p.append(el('h2', '', `Upgrade your ${escapeHtml(from.display)}`));
    const grid = el('div', 'grid');
    for (const t of game.sidegrades(o)) {
      const c = el('button', `card ${game.canAfford(t.price, t.gold) ? '' : 'cant'}`);
      c.innerHTML = `<div class="name">${escapeHtml(t.display)}</div>`;
      const th = el('div', `thumb ${t.missingArt ? 'blank' : ''}`);
      th.style.backgroundImage = `url(${thumbUrl(t)})`;
      c.append(th);
      c.insertAdjacentHTML('beforeend', priceHtml(t.price, t.gold));
      c.onclick = () => panels.confirm(`Change your ${escapeHtml(from.display)} into a ${escapeHtml(t.display)}?`, () => game.sidegrade(o, t));
      grid.append(c);
    }
    p.append(grid);
  });
}
