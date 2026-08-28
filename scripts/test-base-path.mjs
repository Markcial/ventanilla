/**
 * The built site has to work from a subdirectory.
 *
 * GitHub Pages serves a project site under /<repo>/. If the base path is wrong the
 * HTML still loads and its module does not, so WebMCP never registers and the page
 * looks merely broken rather than broken in a way anyone would think to diagnose.
 * That failure only appears once deployed, which is the worst place to find it.
 *
 *   BASE_PATH=/ventanilla/ npm run build && npm run test:pages
 */
import { withWebMCP } from './webmcp-harness.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const PREFIX = (process.env.BASE_PATH ?? '/ventanilla/').replace(/\/$/, '');
const ROOT = resolve('dist');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (PREFIX && !path.startsWith(PREFIX)) { res.writeHead(404).end('not found'); return; }
  path = path.slice(PREFIX.length) || '/';
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}${PREFIX}/`;

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`);
};

console.log(`Deployed-at-a-subpath checks (${PREFIX || '/'})\n`);
try {
  await withWebMCP(url, async c => {
    const status = await c.evaluate(`document.getElementById('webmcp-status').dataset.status`);
    check('the page script ran at all', status === 'ready', `status was "${status}"`);

    const names = c.listTools().map(t => t.name);
    check('every tool registered', names.length >= 5, `only registered [${names}]`);

    const body = c.text(await c.invoke('list_obligations', { withinDays: 200 }));
    check('a tool runs and returns real output', /modelo 303/.test(body), body.slice(0, 120));

    const styled = await c.evaluate(
      `getComputedStyle(document.querySelector('.masthead')).backgroundColor`);
    check('stylesheet resolved', styled !== 'rgba(0, 0, 0, 0)', `masthead background was "${styled}"`);

    const absolute = await c.evaluate(
      `[...document.querySelectorAll('[src],[href]')]
         .map(e => e.getAttribute('src') || e.getAttribute('href'))
         .filter(u => u && u.startsWith('/') && !u.startsWith('${PREFIX}/'))
         .join(', ')`);
    check('no asset escapes the base path', !absolute, `these point outside: ${absolute}`);
  });
} finally {
  server.close();
}

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
