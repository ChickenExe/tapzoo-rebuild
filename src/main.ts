import { Achievements } from './achievements';
import { loadAssets } from './assets';
import { items, loadData } from './data';
import { Game } from './game';
import { UI } from './ui/index';
import { View } from './view';

// CSS can't use absolute asset paths under Electron's file:// origin, so pass them in as variables.
const root = document.documentElement.style;
const abs = (p: string) => `url(${new URL(p, document.baseURI).href})`;
root.setProperty('--splash-img', abs('game/img/Default@2x.png'));
root.setProperty('--panel-img', abs('game/img/listBg.png'));

async function boot(): Promise<void> {
  const fill = document.querySelector<HTMLElement>('.loadfill')!;
  const msg = document.querySelector<HTMLElement>('.loadmsg')!;
  try {
    await loadAssets((f) => (fill.style.width = `${Math.round(f * 90)}%`));
    msg.textContent = 'Opening the zoo…';
    await loadData();
    fill.style.width = '100%';
  } catch (err) {
    msg.innerHTML = `Couldn't load the game files.<br>Run <code>npm run extract</code> first.<br><small>${String(err)}</small>`;
    return;
  }
  const game = new Game();
  const ach = new Achievements(game);
  let ui: UI | null = null;
  const view = new View(game, {
    objectTapped: (o) => ui?.objectTapped(o),
    gateTapped: () => ui?.gateTapped(),
    trashHovered: (o) => ui?.trashHovered(o),
    hovered: (o, at) => ui?.hovered(o, at),
    signTapped: () => ui?.signTapped(),
    groundTapped: () => {},
    ghostPlaced: (g) => ui?.ghostPlaced(g),
    ghostChanged: () => ui?.ghostChanged(),
  });
  document.body.prepend(view.canvas);
  ui = new UI(game, view, ach);
  game.tick();
  document.getElementById('loading')!.classList.add('done');
  setTimeout(() => document.getElementById('loading')?.remove(), 600);
  (window as unknown as { tapzoo: unknown }).tapzoo = { game, view, ui, ach, items };
}

boot();
