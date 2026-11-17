import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as path from 'node:path';
import { Readable } from 'node:stream';

let mainWindow: BrowserWindow | null = null;
let proxyServer: http.Server | null = null;
let proxyBaseUrl = '';

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

      const target = reqUrl.searchParams.get('url');
      if (!target || !/^https?:\/\//i.test(target)) {
        res.writeHead(400);
        res.end('Invalid url parameter');
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
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--tv-local-proxy=${proxyBaseUrl}`],
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
}

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
