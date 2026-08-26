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

const settle = ms => new Promise(r => setTimeout(r, ms));

/** Click a mode button the way a person would, then let the async switch finish. */
async function switchMode(client, mode) {
  await client.evaluate(`document.querySelector('[data-set-mode="${mode}"]').click()`);
  await settle(600);
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

    await check('tools are registered by the time the page finishes loading', async c => {
      // An inspector extension that snapshots the tool list at load must find them.
      // A third-party one reported "0 tools" on this page and fell back to reading
      // the DOM, so this margin is a real requirement, not a micro-optimisation.
      const margin = c.loadRaceMargin();
      assert(margin !== null, 'no toolsAdded event was ever seen');
      assert(margin >= 0,
        `tools appeared ${Math.abs(margin).toFixed(1)}ms after the load event fired`);
      console.log(`       (tools ready ${margin === Infinity ? 'before' : margin.toFixed(1) + 'ms before'} load)`);
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

    await check('demo is the mode a first-time visitor lands in', async c => {
      // A judge has never registered as a Spanish freelancer. The page has to work
      // for them without any setup at all.
      const mode = await c.evaluate(`document.body.dataset.mode`);
      assert(mode === 'demo', `landed in "${mode}" mode`);
      const pressed = await c.evaluate(
        `document.querySelector('[data-set-mode="demo"]').getAttribute('aria-pressed')`);
      assert(pressed === 'true', 'demo button was not shown as selected');
    })(client);

    await check('no tool can change the mode', async c => {
      // The safety boundary of the whole design. An agent able to move someone from
      // demo to real could get them to sign something real while they believed they
      // were trying a demo. Switching stays a human action.
      const suspicious = c.listTools().filter(t =>
        /mode|switch|real|demo/i.test(t.name) || /switch.*mode|enter real/i.test(t.description));
      assert(suspicious.length === 0,
        `these tools look like they could change mode: ${suspicious.map(t => t.name).join(', ')}`);
    })(client);

    await check('tool results say which mode produced them', async c => {
      const body = c.text(await c.invoke('list_obligations', { withinDays: 365 }));
      assert(body.includes('[demo mode'),
        `no mode marker in the result, so an agent could report sample data as real:\n${body}`);
    })(client);

    await check('real mode refuses to guess instead of borrowing demo data', async c => {
      await switchMode(c, 'real');
      const body = c.text(await c.invoke('list_obligations', { withinDays: 365 }));
      assert(body.includes('[real mode'), `mode marker wrong:\n${body}`);
      assert(!/modelo 303/.test(body),
        `real mode answered with deadlines despite an empty profile — it borrowed demo data:\n${body}`);
      assert(/fill/i.test(body), `no prompt to complete the profile:\n${body}`);
    })(client);

    await check('switching modes clears the other mode answers off screen', async c => {
      await switchMode(c, 'demo');
      await c.invoke('list_obligations', { withinDays: 365 });
      const before = Number(await c.evaluate(`document.querySelectorAll('.obligation').length`));
      assert(before > 0, 'demo mode rendered nothing to begin with');
      await switchMode(c, 'real');
      const after = Number(await c.evaluate(`document.querySelectorAll('.obligation').length`));
      assert(after === 0, `${after} demo obligations were still on screen in real mode`);
    })(client);

    await check('real mode offers a form to enter your own details', async c => {
      await switchMode(c, 'real');
      const hasForm = await c.evaluate(`!!document.getElementById('profile-form')`);
      assert(hasForm, 'real mode showed no profile form');
      const demoNif = await c.evaluate(
        `document.querySelector('#profile-form [name=nif]')?.value ?? ''`);
      assert(demoNif === '', `real mode pre-filled the demo tax ID "${demoNif}"`);
      await switchMode(c, 'demo');
    })(client);

    await check('the demo chain is seeded already fingerprinted', async c => {
      // Inert sample rows would sit next to real records showing no QR, and the
      // first invoice an agent added would chain to nothing.
      await switchMode(c, 'demo');
      const withHash = Number(await c.evaluate(
        `[...document.querySelectorAll('.invoice')].filter(e => e.querySelector('.qr svg')).length`));
      assert(withHash >= 6, `only ${withHash} seeded invoices carry a fingerprint and QR`);
    })(client);

    await check('register_invoice is registered', async c => {
      assert(c.listTools().some(t => t.name === 'register_invoice'),
        `tools were [${c.listTools().map(t => t.name)}]`);
    })(client);

    await check('registering an invoice produces a fingerprint and a QR', async c => {
      await switchMode(c, 'demo');
      const body = c.text(await c.invoke('register_invoice', {
        clientName: 'Astillero Ribera SL', clientNif: 'B12345674',
        baseEuros: 800, vatRate: 21, issuedOn: '2026-09-25',
      }));
      assert(/Fingerprint: [0-9A-F]{64}/.test(body), `no 64-char uppercase hex fingerprint:\n${body}`);
      assert(/Total: 968\.00 EUR/.test(body), `800 + 21% should be 968.00:\n${body}`);
      assert(/prewww2\.aeat\.es/.test(body), `QR did not point at the AEAT test endpoint:\n${body}`);
      assert(/never submits/i.test(body), `result did not state that nothing is submitted:\n${body}`);
    })(client);

    await check('each invoice chains to the fingerprint of the one before it', async c => {
      // The property the whole Verifactu mechanism rests on. If this stops holding,
      // the records are decorative.
      const first = c.text(await c.invoke('register_invoice', {
        clientName: 'Chain One', clientNif: 'B11111111', baseEuros: 100, issuedOn: '2026-09-26',
      }));
      const firstHash = /Fingerprint: ([0-9A-F]{64})/.exec(first)?.[1];
      assert(firstHash, `no fingerprint in first result:\n${first}`);

      const second = c.text(await c.invoke('register_invoice', {
        clientName: 'Chain Two', clientNif: 'B22222222', baseEuros: 200, issuedOn: '2026-09-27',
      }));
      const chainedTo = /Chained to: ([0-9A-F]{64})/.exec(second)?.[1];
      assert(chainedTo === firstHash,
        `second invoice chained to ${chainedTo}, but the first was ${firstHash}`);
    })(client);

    await check('registering an invoice puts it on the page with its QR', async c => {
      const before = Number(await c.evaluate(`document.getElementById('invoices').dataset.count`));
      await c.invoke('register_invoice', {
        clientName: 'Visible SL', clientNif: 'B33333333', baseEuros: 50, issuedOn: '2026-09-28',
      });
      const after = Number(await c.evaluate(`document.getElementById('invoices').dataset.count`));
      assert(after === before + 1, `invoice count went ${before} -> ${after}`);
      const qrCount = Number(await c.evaluate(`document.querySelectorAll('.invoice .qr svg').length`));
      assert(qrCount > 0, 'no QR was rendered for any invoice');
      const shown = await c.evaluate(
        `[...document.querySelectorAll('.invoice .client')].map(e => e.textContent).join('|')`);
      assert(shown.includes('Visible SL'), `new invoice not on screen: "${shown}"`);
    })(client);

    await check('an invalid VAT rate is refused rather than guessed', async c => {
      const body = c.text(await c.invoke('register_invoice', {
        clientName: 'Bad Rate', clientNif: 'B44444444', baseEuros: 100, vatRate: 7,
      }));
      assert(/not a Spanish VAT rate/i.test(body), `7% was not refused:\n${body}`);
    })(client);

    await check('real mode will not invent an identity to put on an invoice', async c => {
      await switchMode(c, 'real');
      const body = c.text(await c.invoke('register_invoice', {
        clientName: 'Someone', clientNif: 'B55555555', baseEuros: 100,
      }));
      assert(/cannot issue an invoice/i.test(body), `it issued one anyway:\n${body}`);
      assert(!/Fingerprint: [0-9A-F]{64}/.test(body), `it produced a record despite no identity:\n${body}`);
      await switchMode(c, 'demo');
    })(client);

    await check('demo invoices never appear in real mode', async c => {
      await switchMode(c, 'real');
      const count = Number(await c.evaluate(`document.getElementById('invoices').dataset.count`));
      assert(count === 0, `${count} demo invoices leaked into real mode`);
      await switchMode(c, 'demo');
    })(client);

    await check('a tool brings its own tab forward', async c => {
      // If an agent filled in a tab the person could not see, the answer would be
      // off screen and the premise — that you watch the work happen — would break.
      await switchMode(c, 'demo');
      await c.evaluate(`document.querySelector('[data-tab="profile"]').click()`);
      const parked = await c.evaluate(
        `document.querySelector('[data-tab="profile"]').getAttribute('aria-selected')`);
      assert(parked === 'true', 'could not park on the profile tab first');

      await c.invoke('list_obligations', { withinDays: 365 });
      const onDeadlines = await c.evaluate(
        `document.querySelector('[data-tab="deadlines"]').getAttribute('aria-selected')`);
      assert(onDeadlines === 'true', 'list_obligations left the deadlines tab hidden');
      const visible = await c.evaluate(`!document.querySelector('[data-panel="deadlines"]').hidden`);
      assert(visible, 'the deadlines panel stayed hidden after its tool ran');

      await c.invoke('register_invoice', {
        clientName: 'Tab Focus SL', clientNif: 'B66666666', baseEuros: 10, issuedOn: '2026-09-29',
      });
      const onInvoices = await c.evaluate(
        `document.querySelector('[data-tab="invoices"]').getAttribute('aria-selected')`);
      assert(onInvoices === 'true', 'register_invoice left the invoices tab hidden');
    })(client);

    await check('the invoice count is shown on its tab', async c => {
      const badge = await c.evaluate(`document.querySelector('[data-tab="invoices"] .count').textContent`);
      const actual = await c.evaluate(`document.getElementById('invoices').dataset.count`);
      assert(badge === actual, `tab badge said "${badge}" but there are ${actual} invoices`);
    })(client);

    await check('tabs are reachable by keyboard', async c => {
      await c.evaluate(`document.querySelector('[data-tab="invoices"]').focus()`);
      const roving = await c.evaluate(
        `[...document.querySelectorAll('[data-tab]')].map(t => t.tabIndex).join(',')`);
      assert(/^(0,-1,-1|-1,0,-1|-1,-1,0)$/.test(roving),
        `tab stops should follow the selected tab, got "${roving}"`);
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
