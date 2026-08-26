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
    // Must come first: later checks invoke tools, which fill the page.
    await check('page does not pre-render what a tool produces', async c => {
      // Load-bearing. If the answer is already in the DOM, an agent can scrape it and
      // appear to have used the tool, and the whole premise stops being demonstrable.
      const nodes = Number(await c.evaluate(`document.querySelectorAll('.obligation').length`));
      assert(nodes === 0, `${nodes} obligation nodes were in the DOM before any tool ran`);
    })(client);

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

    await check('list_obligations is registered', async c => {
      assert(c.listTools().some(t => t.name === 'list_obligations'),
        `tools were [${c.listTools().map(t => t.name)}]`);
    })(client);

    await check('list_obligations returns real deadlines', async c => {
      const body = c.text(await c.invoke('list_obligations', { withinDays: 365 }));
      assert(/modelo 303/.test(body), `no modelo 303 in output:\n${body}`);
      assert(/\d{4}-\d{2}-\d{2}/.test(body), `no ISO date in output:\n${body}`);
      assert(/direct debit/.test(body), `direct debit deadline missing:\n${body}`);
    })(client);

    await check('tools register before the load event', async c => {
      const at = Number(await c.evaluate(`window.__toolsRegisteredAt ?? -1`));
      const loadEnd = Number(await c.evaluate(
        `performance.getEntriesByType('navigation')[0].loadEventEnd | 0`));
      assert(at >= 0, 'registration was never instrumented');
      assert(at <= loadEnd + 50,
        `tools registered at ${at}ms, load ended at ${loadEnd}ms — too late for an extension that scans at load`);
    })(client);

    await check('list_obligations mutates the page the human is looking at', async c => {
      await c.invoke('list_obligations', { withinDays: 365 });
      const count = Number(await c.evaluate(`document.getElementById('obligations').dataset.count`));
      assert(count > 0, `obligations panel still empty after the tool ran (count=${count})`);
      const forms = await c.evaluate(
        `[...document.querySelectorAll('.obligation')].map(e => e.dataset.form).join(',')`);
      assert(forms.includes('modelo 303'), `rendered forms were "${forms}"`);
    })(client);

    await check('withinDays actually narrows the result', async c => {
      const wide = c.text(await c.invoke('list_obligations', { withinDays: 365 }));
      const narrow = c.text(await c.invoke('list_obligations', { withinDays: 30 }));
      assert(wide !== narrow, 'wide and narrow windows returned identical output');
      assert(/Nothing due within 30 days/.test(narrow), `unexpected narrow output:\n${narrow}`);
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
