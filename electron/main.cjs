// Electron shell: serves the built game from dist/ over app:// so fetch() and
// localStorage behave like a normal web origin (file:// blocks both).
const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const root = path.join(__dirname, '..', 'dist');

// Smoke tests must never touch the player's real save: TAPZOO_SMOKE_PROFILE points at a copy.
if (process.env.TAPZOO_SMOKE) {
  app.setPath('userData', process.env.TAPZOO_SMOKE_PROFILE || fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tapzoo-smoke-')));
}

// Only one copy may run: two windows sharing one save could overwrite each other's progress.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

// ---------- daily save backups (userData/backups) ----------

const KEEP_BACKUPS = 14;
const backupDir = () => path.join(app.getPath('userData'), 'backups');
const BACKUP_NAME = /^tapzoo-\d{4}-\d{2}-\d{2}\.json$/;

ipcMain.handle('backup:write', (_e, json) => {
  if (typeof json !== 'string' || json.length > 20_000_000) return false;
  fs.mkdirSync(backupDir(), { recursive: true });
  const name = `tapzoo-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(path.join(backupDir(), name), json);
  const all = fs.readdirSync(backupDir()).filter((f) => BACKUP_NAME.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.rmSync(path.join(backupDir(), old));
  return true;
});

ipcMain.handle('backup:list', () => {
  if (!fs.existsSync(backupDir())) return [];
  return fs
    .readdirSync(backupDir())
    .filter((f) => BACKUP_NAME.test(f))
    .sort()
    .reverse()
    .map((name) => ({ name, size: fs.statSync(path.join(backupDir(), name)).size }));
});

ipcMain.handle('backup:read', (_e, name) => {
  if (typeof name !== 'string' || !BACKUP_NAME.test(name)) return null;
  const file = path.join(backupDir(), name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
});

ipcMain.handle('backup:folder', () => {
  fs.mkdirSync(backupDir(), { recursive: true });
  return shell.openPath(backupDir());
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    title: 'Tap Zoo',
    backgroundColor: '#7fd3f0',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.loadURL('app://zoo/index.html');
  // TAPZOO_SMOKE=<png path>: wait for the zoo to open, screenshot it, report state and quit.
  if (process.env.TAPZOO_SMOKE) {
    win.webContents.on('console-message', (e) => console.log(`[renderer] ${e.message}`));
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 4000));
      const state = await win.webContents.executeJavaScript(
        `JSON.stringify({ ok: !!window.tapzoo, loading: document.querySelector('.loadmsg')?.innerText ?? null, objects: window.tapzoo?.game.s.objects.length, coins: window.tapzoo?.game.s.coins, xp: window.tapzoo?.game.s.xp, types: window.tapzoo?.game.s.objects.map((o) => o.type).join(',') })`,
      );
      console.log(`[smoke] ${state}`);
      fs.writeFileSync(process.env.TAPZOO_SMOKE, (await win.webContents.capturePage()).toPNG());
      app.quit();
    });
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(root) || !fs.existsSync(file)) {
      if (process.env.TAPZOO_SMOKE) console.log(`[missing] ${pathname}`);
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
