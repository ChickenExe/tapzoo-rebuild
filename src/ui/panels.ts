// Modal panels and the message queue (level-ups, goal popups) shared by every UI module.
import { button, el, IMG } from './dom';

export class Panels {
  private shade: HTMLElement | null = null;
  private refresher: (() => void) | null = null;
  private queue: (() => void)[] = [];

  constructor(private root: HTMLElement) {}

  get isOpen(): boolean {
    return !!this.shade;
  }

  /** Opens a panel; `refresh` runs every second while it is open. */
  open(cls: string, build: (p: HTMLElement) => void, refresh?: (p: HTMLElement) => void): HTMLElement {
    this.close(false);
    const shade = el('div', 'shade');
    shade.onclick = (e) => e.target === shade && this.close();
    const p = el('div', `panel ${cls}`);
    build(p);
    const close = button('close', '', () => this.close());
    close.style.backgroundImage = `url(${IMG('Close_btn.png')})`;
    p.append(close);
    shade.append(p);
    this.root.append(shade);
    this.shade = shade;
    this.refresher = refresh ? () => refresh(p) : null;
    this.refresher?.();
    return p;
  }

  refresh(): void {
    this.refresher?.();
  }

  close(next = true): void {
    this.shade?.remove();
    this.shade = null;
    this.refresher = null;
    if (next) setTimeout(() => this.drain(), 150);
  }

  /** Queues a popup to show once nothing else is open. */
  enqueue(show: () => void): void {
    this.queue.push(show);
    if (!this.shade) this.drain();
  }

  private drain(): void {
    if (this.shade) return;
    this.queue.shift()?.();
  }

  confirm(text: string, yes: () => void, yesLabel = 'Yes'): void {
    this.open('info confirm', (p) => {
      const body = el('div', 'body', `<p>${text}</p>`);
      const actions = el('div', 'actions');
      actions.append(
        button('btn', yesLabel, () => {
          this.close();
          yes();
        }),
        button('btn ghost', 'No', () => this.close()),
      );
      body.append(actions);
      p.append(body);
    });
  }
}
