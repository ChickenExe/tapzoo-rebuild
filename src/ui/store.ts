// Store (SuperStoreItemsPanel / StoreCategoriesView) and the owned-animals inventory.
import { Category, items, ItemType, thumbUrl } from '../data';
import type { Ctx } from './index';
import { button, duration, el, fmt, IMG, priceHtml } from './dom';

const TABS: { id: Category | 'inventory'; label: string; banner: string }[] = [
  { id: 'animal', label: 'Animals', banner: 'animals.png' },
  { id: 'building', label: 'Buildings', banner: 'supportstructures.png' },
  { id: 'tree', label: 'Trees', banner: 'trees.png' },
  { id: 'decoration', label: 'Decorations', banner: 'decorations.png' },
  { id: 'path', label: 'Paths', banner: 'sidewalks.png' },
  { id: 'staff', label: 'Staff', banner: 'staff.png' },
  { id: 'inventory', label: 'Inventory', banner: 'animals.png' },
];

let lastTab: Category | 'inventory' = 'animal';

export function openStore(ctx: Ctx, tab = lastTab, filter = ''): void {
  lastTab = tab;
  ctx.ui.cancelPlacing();
  const { game, panels } = ctx;
  panels.open('store', (p) => {
    const banner = el('div', 'banner');
    banner.style.backgroundImage = `url(${IMG(TABS.find((t) => t.id === tab)!.banner)})`;
    const tabs = el('div', 'tabs');
    for (const t of TABS) {
      const count = t.id === 'inventory' ? Object.values(game.s.inventory).reduce((a, b) => a + b, 0) : 0;
      tabs.append(button(t.id === tab ? 'tab on' : 'tab', `${t.label}${count ? ` (${count})` : ''}`, () => openStore(ctx, t.id, filter)));
    }
    const search = el('input', 'search') as HTMLInputElement;
    search.placeholder = 'Search…';
    search.value = filter;
    const grid = el('div', 'grid');
    const render = () => {
      grid.innerHTML = '';
      const q = search.value.trim().toLowerCase();
      const list =
        tab === 'inventory'
          ? Object.keys(game.s.inventory).map((n) => items.get(n)!).filter(Boolean)
          : [...items.values()]
              .filter((it) => it.category === tab && game.isAvailable(it) && (it.price > 0 || it.category === 'path'))
              .filter((it) => tab !== 'staff' || !it.gold)
              .sort((a, b) => a.level - b.level || Number(a.gold) - Number(b.gold) || a.price - b.price);
      for (const it of list.filter((i) => !q || i.display.toLowerCase().includes(q))) grid.append(tab === 'inventory' ? inventoryCard(ctx, it) : storeCard(ctx, it));
      if (!grid.children.length) grid.append(el('p', 'empty', tab === 'inventory' ? 'Nothing waiting to be placed. Crossbred animals and gifts land here.' : 'Nothing here.'));
    };
    search.oninput = render;
    render();
    const head = el('div', 'storehead');
    head.append(tabs, search);
    p.append(banner, head, grid);
  });
}

function card(it: ItemType, cls: string): HTMLButtonElement {
  const c = el('button', `card ${cls}`);
  const thumb = el('div', `thumb ${it.missingArt ? 'blank' : ''}`);
  const url = thumbUrl(it);
  if (url) thumb.style.backgroundImage = `url(${url})`;
  c.innerHTML = `<div class="name">${it.display}</div>`;
  c.append(thumb);
  return c;
}

function storeCard(ctx: Ctx, it: ItemType): HTMLElement {
  const { game } = ctx;
  const habitat = game.habitatOf(it.name);
  const why = game.buyCheck(it);
  const locked = it.level > game.level;
  const c = card(it, `${locked ? 'locked' : ''} ${why ? 'cant' : ''}`);
  const extra = habitat
    ? `<div class="stat">In your zoo: ${habitat.count ?? 1} of ${it.maxCount}${(habitat.count ?? 1) < it.maxOwned ? ' · buy a mate' : ''}</div>`
    : it.harvestCoins
      ? `<div class="stat">${fmt(it.harvestCoins)} / ${duration(Math.max(1, it.growMinutes) * 60000)}</div>`
      : it.category === 'staff'
        ? '<div class="stat">Collects coins for you</div>'
        : '';
  const badge = it.category === 'animal' && ctx.crossParents.has(it.name) ? `<img class="badge" src="${IMG('Cross-BreedableBadge.png')}">` : '';
  c.insertAdjacentHTML('beforeend', `${badge}${extra}${locked ? `<div class="lock"><img src="${IMG('lock.png')}">Level ${it.level}</div>` : priceHtml(it.price, it.gold)}`);
  c.onclick = () => {
    if (why) return ctx.ui.toast(why);
    if (it.category === 'staff') {
      game.hire(it);
      return openStore(ctx, 'staff');
    }
    if (habitat) {
      game.addAnimal(it);
      return openStore(ctx, 'animal');
    }
    ctx.ui.startPlacing(it);
  };
  return c;
}

function inventoryCard(ctx: Ctx, it: ItemType): HTMLElement {
  const c = card(it, '');
  c.insertAdjacentHTML('beforeend', `<div class="stat">×${ctx.game.s.inventory[it.name]}</div><div class="place-label">Place in zoo</div>`);
  c.onclick = () => ctx.ui.startPlacing(it, true);
  return c;
}
