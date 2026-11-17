import { spawn } from 'node:child_process';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(desktopDir, '../..');
const viteUrl = 'http://localhost:5173';

function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timeout waiting for ${url}`));
          return;
        }
        setTimeout(attempt, 400);
      });
    };
    attempt();
  });
}

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

// 1. Compile Electron TypeScript
const tsc = spawn(npmCmd, ['exec', '--', 'tsc'], {
  cwd: desktopDir,
  stdio: 'inherit',
  shell: isWin,
});

tsc.on('exit', async (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }

  // 2. Start Vite dev server
  const viteProc = spawn(npmCmd, ['--workspace=@tv-local/web', 'run', 'dev'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: isWin,
  });

  try {
    await waitForServer(viteUrl);
    // 3. Launch Electron pointing to Vite
    const electronProc = spawn(npmCmd, ['exec', '--', 'electron', '.'], {
      cwd: desktopDir,
      stdio: 'inherit',
      shell: isWin,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: viteUrl,
      },
    });

    electronProc.on('exit', (eCode) => {
      viteProc.kill();
      process.exit(eCode ?? 0);
    });
  } catch (err) {
    console.error(err);
    viteProc.kill();
    process.exit(1);
  }
});
