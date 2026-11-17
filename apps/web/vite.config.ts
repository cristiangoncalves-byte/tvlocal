import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { Readable } from 'node:stream';

/**
 * Dev-only HTTP proxy plugin so browser requests to external M3U/Xtream/HLS URLs
 * can bypass CORS restrictions during local development.
 */
function localCorsProxyPlugin(): Plugin {
  return {
    name: 'tv-local-cors-proxy',
    configureServer(server) {
      server.middlewares.use('/api/proxy', async (req, res) => {
        const reqUrl = new URL(req.url ?? '', 'http://localhost');
        const target = reqUrl.searchParams.get('url');

        if (!target || !/^https?:\/\//i.test(target)) {
          res.statusCode = 400;
          res.end('Parâmetro ?url= inválido');
          return;
        }

        try {
          const upstream = await fetch(target, {
            headers: {
              'User-Agent': req.headers['x-proxy-ua']?.toString() || 'TVLocal/1.0',
            },
            redirect: 'follow',
          });

          res.statusCode = upstream.status;
          const contentType = upstream.headers.get('content-type');
          if (contentType) {
            res.setHeader('Content-Type', contentType);
          }
          res.setHeader('Access-Control-Allow-Origin', '*');

          if (!upstream.body) {
            res.end();
            return;
          }

          Readable.fromWeb(upstream.body as never).pipe(res);
        } catch (err) {
          res.statusCode = 502;
          res.end(`Falha no proxy local: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), localCorsProxyPlugin()],
  server: {
    port: 5173,
    strictPort: false,
  },
});
