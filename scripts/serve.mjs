import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2',
};

/**
 * Serve `root` on an OS-assigned free port, bound to 127.0.0.1.
 *
 * The port is never hardcoded: a fixed one collided with an unrelated dev server
 * already bound to [::1], and `localhost` resolved to that one first — so the
 * tests silently ran against someone else's page.
 *
 * Returns { url, port, stop }.
 */
export async function serve(root) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = resolve(join(base, path));
      if (file !== base && !file.startsWith(base + sep)) throw new Error('path traversal');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ok);
  });
  const { port } = server.address();
  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    stop: () => new Promise(r => server.close(r)),
  };
}
