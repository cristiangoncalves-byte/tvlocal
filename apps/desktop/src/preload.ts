import { contextBridge, ipcRenderer } from 'electron';

const proxyArg = process.argv.find((arg) => arg.startsWith('--tv-local-proxy='));
const proxyBaseUrl = proxyArg ? proxyArg.slice('--tv-local-proxy='.length) : '';

contextBridge.exposeInMainWorld('tvLocalDesktop', {
  isElectron: true,
  proxyBaseUrl,
  platform: process.platform,
  openM3uFile: () =>
    ipcRenderer.invoke('tv-local:open-m3u') as Promise<{ name: string; content: string } | null>,
});
