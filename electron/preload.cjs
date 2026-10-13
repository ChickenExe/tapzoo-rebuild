// Bridge for the few things the game needs from the desktop: daily save backups.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tapzooHost', {
  writeBackup: (json) => ipcRenderer.invoke('backup:write', json),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  readBackup: (name) => ipcRenderer.invoke('backup:read', name),
  openBackupFolder: () => ipcRenderer.invoke('backup:folder'),
});
