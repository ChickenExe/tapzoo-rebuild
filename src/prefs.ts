// Per-computer display/audio preferences (kept apart from the zoo save, which can be exported).

export interface Prefs {
  musicVolume: number;
  uiScale: number;
  showTimers: boolean;
}

const KEY = 'tapzoo-prefs';
const DEFAULTS: Prefs = { musicVolume: 0.5, uiScale: 1, showTimers: false };

export const prefs: Prefs = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function savePrefs(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}
