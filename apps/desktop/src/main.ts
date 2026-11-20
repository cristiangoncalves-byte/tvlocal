import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as crypto from 'node:crypto';
import * as dns from 'node:dns/promises';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { Readable } from 'node:stream';

let mainWindow: BrowserWindow | null = null;
let proxyServer: http.Server | null = null;
let proxyBaseUrl = '';
const proxyToken = crypto.randomBytes(24).toString('hex');

function isBlockedHostAddress(rawIp: string): boolean {
  const ip = rawIp.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    ip === '::1' ||
    ip === '::' ||
    ip === '0.0.0.0' ||
    ip.startsWith('127.') ||
    ip.startsWith('0.') ||
    ip.startsWith('169.254.') ||
    ip.startsWith('fe80:') ||
    ip.startsWith('::ffff:127.') ||
    ip.startsWith('::ffff:0.') ||
    ip.startsWith('::ffff:169.254.')
  ) {
    return true;
  }
  return false;
}

async function isSafeProxyTarget(targetUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    return false;
  }

  if (net.isIP(host) !== 0) {
    return !isBlockedHostAddress(host);
  }

  try {
    const records = await dns.lookup(host, { all: true });
    return records.length > 0 && records.every((r) => !isBlockedHostAddress(r.address));
  } catch {
    return false;
  }
}

function startLocalProxy(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        });
        res.end();
        return;
      }

      const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (reqUrl.pathname !== '/proxy') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      if (reqUrl.searchParams.get('token') !== proxyToken) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      const target = reqUrl.searchParams.get('url');
      if (!target || !/^https?:\/\//i.test(target)) {
        res.writeHead(400);
        res.end('Invalid url parameter');
        return;
      }

      if (!(await isSafeProxyTarget(target))) {
        res.writeHead(403);
        res.end('Blocked host');
        return;
      }

      try {
        const upstream = await fetch(target, {
          headers: {
            'User-Agent': 'TVLocalDesktop/1.0',
          },
          redirect: 'follow',
        });

        const headers: Record<string, string> = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
        };
        const contentType = upstream.headers.get('content-type');
        if (contentType) {
          headers['Content-Type'] = contentType;
        }

        res.writeHead(upstream.status, headers);
        if (!upstream.body) {
          res.end();
          return;
        }
        Readable.fromWeb(upstream.body as never).pipe(res);
      } catch (err) {
        res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
        res.end(`Proxy error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind local proxy'));
        return;
      }
      proxyServer = server;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

async function createMainWindow() {
  proxyBaseUrl = await startLocalProxy();
  process.env.TV_LOCAL_PROXY_URL = proxyBaseUrl;

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#080c14',
    title: 'TV Local — IPTV Player',
    icon: path.resolve(__dirname, '../assets/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        `--tv-local-proxy=${proxyBaseUrl}`,
        `--tv-local-proxy-token=${proxyToken}`,
      ],
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    const packagedWeb = path.join(process.resourcesPath, 'web-dist', 'index.html');
    const localWeb = path.resolve(__dirname, '../../web/dist/index.html');
    const targetFile = await fs
      .access(localWeb)
      .then(() => localWeb)
      .catch(() => packagedWeb);
    await mainWindow.loadFile(targetFile);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  }
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-downloaded', async (info) => {
  const res = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Reiniciar e Atualizar', 'Mais tarde'],
    defaultId: 0,
    title: 'Atualização pronta — TV Local',
    message: `A versão ${info.version} foi baixada.`,
    detail: 'Deseja reiniciar o aplicativo agora para concluir a atualização?',
  });
  if (res.response === 0) {
    autoUpdater.quitAndInstall();
  }
});

ipcMain.handle('tv-local:get-version', () => app.getVersion());

ipcMain.handle('tv-local:check-updates', async () => {
  if (!app.isPackaged) {
    return {
      status: 'dev',
      currentVersion: app.getVersion(),
      message: 'Modo de desenvolvimento (empacote o app para usar auto-update nativo).',
    };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const nextVersion = result?.updateInfo?.version;
    if (nextVersion && nextVersion !== app.getVersion()) {
      return {
        status: 'available',
        currentVersion: app.getVersion(),
        latestVersion: nextVersion,
        message: `Nova versão ${nextVersion} encontrada e sendo baixada em segundo plano.`,
      };
    }
    return {
      status: 'up-to-date',
      currentVersion: app.getVersion(),
      message: `Você já está na versão mais recente (v${app.getVersion()}).`,
    };
  } catch (err) {
    return {
      status: 'error',
      currentVersion: app.getVersion(),
      message: err instanceof Error ? err.message : 'Falha ao buscar atualizações.',
    };
  }
});

ipcMain.handle('tv-local:open-m3u', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Selecionar lista M3U / M3U8',
    filters: [{ name: 'Playlists IPTV', extensions: ['m3u', 'm3u8', 'txt'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  const filePath = result.filePaths[0];
  const content = await fs.readFile(filePath, 'utf-8');
  return {
    name: path.basename(filePath),
    content,
  };
});

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (proxyServer) {
    proxyServer.close();
    proxyServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});
