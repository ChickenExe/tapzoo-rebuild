// Goals (AchievementListController / SingleAchievementPanel) and their popups.
import { hasImage } from '../assets';
import type { Achievement } from '../data';
import type { Ctx } from './index';
import { button, el, escapeHtml, IMG, iconUrl } from './dom';

const rewardHtml = (a: Achievement) =>
  a.rewards
    .map((r) => {
      const [verb, ...rest] = r.split(':');
      const arg = rest.join(':');
      if (verb === 'coins') return `${Number(arg).toLocaleString('en-US')} coins`;
      if (verb === 'exp') return `${Number(arg).toLocaleString('en-US')} XP`;
      if (verb === 'gold') return `${arg} stars`;
      if (verb === 'unlock') return `unlocks ${escapeHtml(arg)}`;
      if (verb === 'give') return `a gift: ${escapeHtml(JSON.parse(arg).name)}`;
      if (verb === 'PutExclamationOn') return 'a new upgrade';
      return '';
    })
    .filter(Boolean)
    .join(' · ');

export function goalLines(ctx: Ctx, a: Achievement): HTMLElement {
  const list = el('div', 'reqs');
  for (const r of a.requirements) {
    const p = ctx.ach.progress(a, r);
    const row = el('div', `req ${p.done ? 'done' : ''}`);
    const frac = Math.max(0, Math.min(1, p.need ? p.have / p.need : 1));
    row.innerHTML = `<img src="${iconUrl(p.icon ?? a.icon)}"><div class="reqtext">${escapeHtml(p.text)}<div class="bar"><div style="width:${frac * 100}%"></div></div></div><div class="count">${p.done ? '✓' : `${Math.floor(Math.min(p.have, p.need))}/${p.need}`}</div>`;
    list.append(row);
  }
  return list;
}

export function openGoal(ctx: Ctx, a: Achievement): void {
  ctx.panels.open(
    'info goal',
    (p) => {
      const head = el('div', 'goalhead', `<img src="${iconUrl(a.icon)}"><h2>${escapeHtml(a.name)}</h2>`);
      p.append(head, el('p', 'desc', escapeHtml(a.description || '')), el('div', 'lines'));
      const rw = rewardHtml(a);
      if (rw) p.append(el('p', 'reward', `Reward: ${rw}`));
      p.append(button('btn ghost back', '‹ All goals', () => openGoals(ctx)));
    },
    (p) => {
      const box = p.querySelector('.lines')!;
      box.replaceChildren(goalLines(ctx, a));
    },
  );
}

export function openGoals(ctx: Ctx, tab: 'active' | 'done' = 'active'): void {
  const { ach } = ctx;
  ctx.panels.open('goals', (p) => {
    const bg = el('div', 'goalsbg');
    bg.style.backgroundImage = `url(${IMG(tab === 'active' ? 'achievement_bg.png' : 'CompletedAchievementspanel.png')})`;
    p.append(bg);
    const tabs = el('div', 'tabs');
    tabs.append(
      button(tab === 'active' ? 'tab on' : 'tab', 'Active goals', () => openGoals(ctx, 'active')),
      button(tab === 'done' ? 'tab on' : 'tab', `Completed (${ach.completed().length})`, () => openGoals(ctx, 'done')),
    );
    p.append(tabs);
    const list = el('div', 'goallist');
    const goals = tab === 'active' ? ach.visible() : ach.completed().reverse();
    for (const a of goals) {
      const row = el('button', 'goalrow');
      row.innerHTML = `<img src="${iconUrl(tab === 'done' ? a.completedIcon || a.icon : a.icon, tab === 'done' ? 'pawprint_Icon-completed.png' : 'pawprint_Icon.png')}"><div><b>${escapeHtml(a.name)}</b><br><small>${escapeHtml(a.description || '')}</small></div>`;
      if (tab === 'active') row.onclick = () => openGoal(ctx, a);
      list.append(row);
    }
    if (!goals.length) list.append(el('p', 'empty', tab === 'active' ? 'No goals right now — keep growing your zoo!' : 'Nothing completed yet.'));
    p.append(list);
  });
}

/** Story text popup shown when a goal starts (initMessage) or completes (completionDescription). */
export function goalPopup(ctx: Ctx, title: string, text: string, image: string | undefined, reward: string, then?: () => void): void {
  ctx.panels.enqueue(() =>
    ctx.panels.open('info story', (p) => {
      const trophy = el('div', 'trophy');
      trophy.style.backgroundImage = `url(${IMG('trophy-icon.png')})`;
      p.append(el('h2', '', escapeHtml(title)));
      if (image && hasImage(image)) {
        const pic = el('div', 'storyimg');
        pic.style.backgroundImage = `url(${IMG(image)})`;
        p.append(pic);
      } else p.append(trophy);
      const body = el('div', 'body');
      body.innerHTML = `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>${reward ? `<p class="reward">${reward}</p>` : ''}`;
      body.append(
        button('btn', 'OK', () => {
          ctx.panels.close();
          then?.();
        }),
      );
      p.append(body);
    }),
  );
}
