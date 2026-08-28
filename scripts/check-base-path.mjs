/**
 * Static base-path check. No browser, so it runs anywhere.
 *
 * The failure it exists for: a project site is served from /<repo>/, and with a
 * wrong base the HTML still loads while its module 404s. WebMCP never registers
 * and the page looks merely broken rather than broken in a way anyone would think
 * to diagnose.
 *
 * Every root-relative reference must sit under the base, and the file it names
 * must actually be in the build. That is enough to catch it. The browser-driven
 * version, npm run test:pages, additionally proves the tools register — it needs a
 * real Chrome with the WebMCP trial, so it stays a local command.
 *
 *   BASE_PATH=/ventanilla/ npm run build && BASE_PATH=/ventanilla/ npm run check:base
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const base = (process.env.BASE_PATH ?? '/').replace(/\/+$/, '');
const html = readFileSync('dist/index.html', 'utf8');

const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map(m => m[1])
  .filter(u => u.startsWith('/'));

const problems = [];

for (const ref of refs) {
  if (base && !ref.startsWith(`${base}/`)) {
    problems.push(`${ref} does not sit under ${base}/`);
    continue;
  }
  const file = join('dist', ref.slice(base.length));
  if (!existsSync(file)) problems.push(`${ref} is not in the build (looked for ${file})`);
}

console.log(`Base path check (${base || '/'})\n`);
console.log(`  ${refs.length} root-relative reference(s) in dist/index.html`);

// A build with no local assets at all would pass vacuously.
if (refs.length === 0) {
  console.log('\n  FAIL no root-relative references at all — did the build emit assets?');
  process.exit(1);
}

for (const p of problems) console.log(`  FAIL ${p}`);
if (problems.length === 0) console.log('  ok   every reference is under the base and present');

console.log(`\n${refs.length - problems.length}/${refs.length} passed`);
process.exit(problems.length ? 1 : 0);
