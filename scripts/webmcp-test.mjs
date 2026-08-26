/**
 * Integration tests for the WebMCP tool surface.
 *
 * Builds nothing — run `npm run build` first. Serves dist/, drives a headless
 * Chrome through the CDP WebMCP domain, and asserts on the real tool output.
 */
import { withWebMCP } from './webmcp-harness.mjs';
import { serve } from './serve.mjs';

const results = [];

function check(name, fn) {
  return async client => {
    try {
      await fn(client);
      results.push({ name, ok: true });
      console.log(`  ok   ${name}`);
    } catch (err) {
      results.push({ name, ok: false, err: err.message });
      console.log(`  FAIL ${name}\n       ${err.message}`);
    }
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const site = await serve('dist');
console.log(`serving dist/ at ${site.url}`);
console.log('WebMCP integration tests\n');

try {
  await withWebMCP(site.url, async client => {
    await check('page reports WebMCP ready', async c => {
      const status = await c.evaluate(`document.getElementById('webmcp-status').dataset.status`);
      assert(status === 'ready', `status was "${status}", expected "ready"`);
    })(client);

    await check('ping is registered and discoverable', async c => {
      const names = c.listTools().map(t => t.name);
      assert(names.includes('ping'), `tools were [${names}]`);
    })(client);

    await check('every tool has a non-trivial description', async c => {
      for (const t of c.listTools()) {
        assert(t.description && t.description.length > 20,
          `tool "${t.name}" description too short: "${t.description}"`);
      }
    })(client);

    await check('ping returns pong with a timestamp', async c => {
      const out = await c.invoke('ping');
      const body = c.text(out);
      assert(body.startsWith('pong '), `got "${body}"`);
      assert(!Number.isNaN(Date.parse(body.slice(5))), `no parseable timestamp in "${body}"`);
    })(client);

    await check('unknown tool fails loudly', async c => {
      let threw = false;
      try { await c.invoke('does_not_exist'); } catch { threw = true; }
      assert(threw, 'invoking a missing tool should throw');
    })(client);
  });
} finally {
  await site.stop();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
