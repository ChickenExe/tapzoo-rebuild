// Daily save backups. In the desktop app they are files in the save folder (via the preload
// bridge); in a plain browser they fall back to a few localStorage slots.

interface HostApi {
  writeBackup(json: string): Promise<boolean>;
  listBackups(): Promise<{ name: string; size: number }[]>;
  readBackup(name: string): Promise<string | null>;
  openBackupFolder(): Promise<string>;
}

const host = (window as unknown as { tapzooHost?: HostApi }).tapzooHost;
const LOCAL_PREFIX = 'tapzoo-backup-';
const LOCAL_KEEP = 5;

export const backupsAreFiles = !!host;

export async function writeBackup(json: string): Promise<void> {
  try {
    if (host) {
      await host.writeBackup(json);
      return;
    }
    localStorage.setItem(`${LOCAL_PREFIX}${new Date().toISOString().slice(0, 10)}`, json);
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(LOCAL_PREFIX)).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - LOCAL_KEEP))) localStorage.removeItem(k);
  } catch {
    // A failed backup must never interrupt play.
  }
}

export async function listBackups(): Promise<{ name: string; date: string }[]> {
  try {
    if (host) return (await host.listBackups()).map((b) => ({ name: b.name, date: b.name.slice(7, 17) }));
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(LOCAL_PREFIX))
      .sort()
      .reverse()
      .map((k) => ({ name: k, date: k.slice(LOCAL_PREFIX.length) }));
  } catch {
    return [];
  }
}

export async function readBackup(name: string): Promise<string | null> {
  try {
    return host ? await host.readBackup(name) : localStorage.getItem(name);
  } catch {
    return null;
  }
}

export function openBackupFolder(): void {
  host?.openBackupFolder();
}
