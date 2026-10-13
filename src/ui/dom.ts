// Small DOM helpers shared by the UI modules.
import { hasImage, imageUrl } from '../assets';

export const IMG = (n: string) => imageUrl(n);

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function button(cls: string, html: string, onclick: () => void): HTMLButtonElement {
  const b = el('button', cls, html);
  b.onclick = (e) => {
    e.stopPropagation();
    onclick();
  };
  return b;
}

export function fmt(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return sec ? `${m}m ${sec}s` : `${m}m`;
  return `${sec}s`;
}

export function priceHtml(amount: number, gold: boolean): string {
  return `<span class="price ${gold ? 'gold' : ''}"><img src="${IMG(gold ? 'blue_star_doober_30x30.png' : 'coin_30x30.png')}">${fmt(amount)}</span>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Achievement icons: many were downloaded content, so fall back to the paw print. */
export function iconUrl(name: string | undefined, fallback = 'pawprint_Icon.png'): string {
  const fixed = name?.replace('pawprint_icon', 'pawprint_Icon');
  return IMG(fixed && hasImage(fixed) ? fixed : fallback);
}
