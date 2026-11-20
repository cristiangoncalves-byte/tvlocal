import { contextBridge, ipcRenderer } from 'electron';

const proxyArg = process.argv.find((arg) => arg.startsWith('--tv-local-proxy='));
const proxyBaseUrl = proxyArg ? proxyArg.slice('--tv-local-proxy='.length) : '';
const proxyTokenArg = process.argv.find((arg) => arg.startsWith('--tv-local-proxy-token='));
const proxyToken = proxyTokenArg ? proxyTokenArg.slice('--tv-local-proxy-token='.length) : '';

contextBridge.exposeInMainWorld('tvLocalDesktop', {
  isElectron: true,
  proxyBaseUrl,
  proxyToken,
  platform: process.platform,
  openM3uFile: () =>
    ipcRenderer.invoke('tv-local:open-m3u') as Promise<{ name: string; content: string } | null>,
  getAppVersion: () => ipcRenderer.invoke('tv-local:get-version') as Promise<string>,
  checkForUpdates: () =>
    ipcRenderer.invoke('tv-local:check-updates') as Promise<{
      status: 'dev' | 'available' | 'up-to-date' | 'error';
      currentVersion: string;
      latestVersion?: string;
      message: string;
    }>,
});
