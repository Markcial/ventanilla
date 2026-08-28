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
        clientName: 'Astillero Ribera SL', clientNif: '89890002E',
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
        clientName: 'Chain One', clientNif: '89890003T', baseEuros: 100, issuedOn: '2026-09-26',
      }));
      const firstHash = /Fingerprint: ([0-9A-F]{64})/.exec(first)?.[1];
      assert(firstHash, `no fingerprint in first result:\n${first}`);

      const second = c.text(await c.invoke('register_invoice', {
        clientName: 'Chain Two', clientNif: '89890004R', baseEuros: 200, issuedOn: '2026-09-27',
      }));
      const chainedTo = /Chained to: ([0-9A-F]{64})/.exec(second)?.[1];
      assert(chainedTo === firstHash,
        `second invoice chained to ${chainedTo}, but the first was ${firstHash}`);
    })(client);

    await check('registering an invoice puts it on the page with its QR', async c => {
      const before = Number(await c.evaluate(`document.getElementById('invoices').dataset.count`));
      await c.invoke('register_invoice', {
        clientName: 'Visible SL', clientNif: '89890005W', baseEuros: 50, issuedOn: '2026-09-28',
      });
      const after = Number(await c.evaluate(`document.getElementById('invoices').dataset.count`));
      assert(after === before + 1, `invoice count went ${before} -> ${after}`);
      const qrCount = Number(await c.evaluate(`document.querySelectorAll('.invoice .qr svg').length`));
      assert(qrCount > 0, 'no QR was rendered for any invoice');
      const shown = await c.evaluate(
        `[...document.querySelectorAll('.invoice .client')].map(e => e.textContent).join('|')`);
      assert(shown.includes('Visible SL'), `new invoice not on screen: "${shown}"`);
    })(client);

    await check('omitting the rate gives the ordinary 21%', async c => {
      // The rate is optional, and the common case has to be what you get for free.
      const body = c.text(await c.invoke('register_invoice', {
        clientName: 'Default Rate SL', clientNif: '89890002E', baseEuros: 100, issuedOn: '2026-08-27' }));
      assert(/VAT 21%: 21\.00/.test(body), `omitting vatRate did not give 21%:\n${body}`);
    })(client);

    await check('the rate enum leads with the ordinary case', async c => {
      // An agent filling in every optional field takes the first value. Leading
      // with 0 produced exactly that: invoices with no VAT nobody asked for.
      const tool = c.listTools().find(t => t.name === 'register_invoice');
      const values = tool.inputSchema.properties.vatRate.enum;
      assert(values[0] === 21, `the enum leads with ${values[0]}, not 21: ${values}`);
      assert(values.at(-1) === 0, `0 should be last, got ${values}`);
    })(client);

    await check('a zero-VAT invoice is not created without a reason', async c => {
      // Asked here rather than at submission time: this is when the person is
      // thinking about this invoice.
      const before = Number(await c.evaluate(`document.getElementById('invoices').dataset.count`));
      const body = c.text(await c.invoke('register_invoice', {
        clientName: 'No Reason SL', clientNif: '89890003T', baseEuros: 100,
        vatRate: 0, issuedOn: '2026-08-27' }));
      const after = Number(await c.evaluate(`document.getElementById('invoices').dataset.count`));
      assert(after === before, 'a zero-VAT invoice with no reason was created anyway');
      assert(/leave the rate out|without vatRate/.test(body),
        `it did not suggest that 0% may have been a mistake:\n${body}`);
      assert(/E1, E2/.test(body) && /N1, N2/.test(body), `it did not list the codes:\n${body}`);
    })(client);

    await check('a zero-VAT invoice records the reason it was given', async c => {
      const body = c.text(await c.invoke('register_invoice', {
        clientName: 'Exempt SL', clientNif: '89890004R', baseEuros: 100,
        vatRate: 0, vatTreatment: 'N1', issuedOn: '2026-08-27' }));
      assert(/\(N1\)/.test(body), `the reason is not shown back:\n${body}`);
      const id = /Invoice (\S+) registered/.exec(body)?.[1];
      assert(id, `no serial in:\n${body}`);
      const exported = c.text(await c.invoke('export_submission', { invoiceId: id }));
      assert(!/ask the person/i.test(exported), `export asked again:\n${exported}`);
      const envelope = await c.evaluate(`document.querySelector('#submission .envelope code').textContent`);
      assert(/<sf:CalificacionOperacion>N1<\/sf:CalificacionOperacion>/.test(envelope),
        'the recorded treatment did not reach the envelope');
    })(client);

    await check('a bad treatment code is refused at registration', async c => {
      const body = c.text(await c.invoke('register_invoice', {
        clientName: 'Bad Code SL', clientNif: '89890005W', baseEuros: 100,
        vatRate: 0, vatTreatment: 'X9', issuedOn: '2026-08-27' }));
      assert(/not a VAT treatment code/.test(body), `"X9" was accepted:\n${body}`);
    })(client);

    await check('an invalid VAT rate is refused rather than guessed', async c => {
      const body = c.text(await c.invoke('register_invoice', {
        clientName: 'Bad Rate', clientNif: '89890006A', baseEuros: 100, vatRate: 7,
      }));
      assert(/not a Spanish VAT rate/i.test(body), `7% was not refused:\n${body}`);
    })(client);

    await check('real mode will not invent an identity to put on an invoice', async c => {
      await switchMode(c, 'real');
      const body = c.text(await c.invoke('register_invoice', {
        clientName: 'Someone', clientNif: '89890007G', baseEuros: 100,
      }));
      assert(/not registered/i.test(body) && /name or tax ID/i.test(body),
        `it issued one anyway:\n${body}`);
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
        clientName: 'Tab Focus SL', clientNif: '89890008M', baseEuros: 10, issuedOn: '2026-09-29',
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
      // Exactly one tab stop, on the selected tab, however many tabs there are.
      const stops = (await c.evaluate(
        `[...document.querySelectorAll('[data-tab]')].map(t => t.tabIndex).join(',')`)).split(',');
      assert(stops.filter(v => v === '0').length === 1 && stops.every(v => v === '0' || v === '-1'),
        `tab stops should be a single 0 among -1s, got "${stops.join(',')}"`);
      const selectedIsStop = await c.evaluate(
        `document.querySelector('[data-tab][aria-selected="true"]').tabIndex === 0`);
      assert(selectedIsStop, 'the tab stop is not on the selected tab');
    })(client);

    await check('prepare_vat_return works out the quarter from the invoices', async c => {
      await switchMode(c, 'demo');
      const body = c.text(await c.invoke('prepare_vat_return', { year: 2026, quarter: 3 }));
      assert(/Modelo 303, 3T 2026/.test(body), `wrong period:\n${body}`);
      assert(/\[01\].*890\.00/.test(body), `the 10% base should take the first rate row:\n${body}`);

      // Exact arithmetic belongs to the unit tests, which use fixed data. Earlier
      // checks in this run register invoices of their own, so what matters here is
      // that the sheet adds up against itself.
      const rowQuotas = [...body.matchAll(/\[(?:03|06|09)\] Cuota: ([\d.]+)/g)].map(m => Number(m[1]));
      const total = Number(/\[27\] Total cuota devengada: ([\d.]+)/.exec(body)?.[1]);
      const summed = Number(rowQuotas.reduce((a, b) => a + b, 0).toFixed(2));
      assert(rowQuotas.length > 0, `no rate-row quotas in the sheet:\n${body}`);
      assert(Math.abs(total - summed) < 0.005,
        `box 27 says ${total} but the rate rows add up to ${summed}`);
      assert(/\[46\] Resultado régimen general[^:]*: ([\d.]+)/.exec(body)?.[1] === String(total.toFixed(2)),
        `box 46 should equal box 27 minus zero deductible:\n${body}`);
    })(client);

    await check('the return says what it could not account for', async c => {
      const body = c.text(await c.invoke('prepare_vat_return', { year: 2026, quarter: 3 }));
      assert(/only records invoices you issue/i.test(body),
        `it did not admit that input VAT is missing:\n${body}`);
      assert(/DEMO-2026-005/.test(body), `the zero-rated invoice was not flagged:\n${body}`);
    })(client);

    await check('the return lands on its own tab as a numbered sheet', async c => {
      await c.invoke('prepare_vat_return', { year: 2026, quarter: 3 });
      const tab = await c.evaluate(
        `document.querySelector('[data-tab="vat-return"]').getAttribute('aria-selected')`);
      assert(tab === 'true', 'the Modelo 303 tab was not brought forward');
      const boxes = Number(await c.evaluate(`document.getElementById('vat-return').dataset.boxes`));
      assert(boxes > 10, `only ${boxes} boxes rendered`);
      const numbers = await c.evaluate(
        `[...document.querySelectorAll('.boxes .num')].map(e => e.textContent).join(',')`);
      for (const n of ['[27]', '[45]', '[46]', '[71]']) {
        assert(numbers.includes(n), `box ${n} missing from the sheet: ${numbers}`);
      }
    })(client);

    await check('the return points at preproduction, never the live form', async c => {
      const page = await c.evaluate(`document.body.innerHTML`);
      assert(/prewww2\.aeat\.es\/wlpl\/A303-FWME/.test(page), 'no link to the preproduction form');
      assert(!/www1\.agenciatributaria\.gob\.es\/wlpl\/A303/.test(page),
        'the live 303 form is linked somewhere');
    })(client);

    await check('an empty quarter produces a valid empty return', async c => {
      const body = c.text(await c.invoke('prepare_vat_return', { year: 2026, quarter: 1 }));
      assert(/0 rate row/.test(body), `expected an empty return:\n${body}`);
      assert(/\[27\] Total cuota devengada: 0\.00/.test(body), `box 27 should be zero:\n${body}`);
    })(client);

    await check('export_submission is registered', async c => {
      assert(c.listTools().some(t => t.name === 'export_submission'),
        `tools were [${c.listTools().map(t => t.name)}]`);
    })(client);

    await check('a prepared submission lands on screen with a download', async c => {
      await switchMode(c, 'demo');
      const body = c.text(await c.invoke('export_submission', { invoiceId: 'DEMO-2026-001' }));
      assert(/prewww1\.aeat\.es/.test(body), `no AEAT test endpoint in the result:\n${body}`);
      const shown = await c.evaluate(`document.querySelector('#submission .envelope code')?.textContent ?? ''`);
      assert(shown.includes('RegFactuSistemaFacturacion'), 'no envelope rendered');
      const button = await c.evaluate(`!!document.getElementById('download-submission')`);
      assert(button, 'no download button offered');
      const tab = await c.evaluate(
        `document.querySelector('[data-tab="submission"]').getAttribute('aria-selected')`);
      assert(tab === 'true', 'the submission tab was not brought forward');
    })(client);

    await check('the envelope carries the stored generation time, not a fresh one', async c => {
      // A new timestamp would produce a record whose Huella does not match its own
      // contents, which the AEAT marks as accepted with errors.
      await c.invoke('export_submission', { invoiceId: 'DEMO-2026-001' });
      const envelope = await c.evaluate(`document.querySelector('#submission .envelope code').textContent`);
      assert(/<sf:FechaHoraHusoGenRegistro>2026-07-03T09:00:00\+02:00<\/sf:FechaHoraHusoGenRegistro>/.test(envelope),
        `generation time was not the stored one:\n${/FechaHoraHusoGenRegistro>[^<]*/.exec(envelope)?.[0]}`);
    })(client);

    await check('an exempt invoice exports from what it already records', async c => {
      // The reason is captured when the invoice is created, so submitting it does
      // not interrogate someone about an invoice they filed away days ago.
      const body = c.text(await c.invoke('export_submission', { invoiceId: 'DEMO-2026-005' }));
      assert(/on screen/.test(body), `it refused a recorded exempt invoice:\n${body}`);
      assert(!/ask the person/i.test(body), `it asked again despite the reason being recorded:\n${body}`);
      const envelope = await c.evaluate(`document.querySelector('#submission .envelope code').textContent`);
      assert(/<sf:OperacionExenta>E1<\/sf:OperacionExenta>/.test(envelope),
        'the recorded exemption did not reach the envelope');
      assert(!/<sf:TipoImpositivo>/.test(envelope), 'an exempt line should carry no rate');
    })(client);

    await check('the send form is a real form, aimed only at preproduction', async c => {
      await switchMode(c, 'demo');
      await c.invoke('export_submission', { invoiceId: 'DEMO-2026-002' });
      const action = await c.evaluate(`document.querySelector('form.send')?.action ?? ''`);
      assert(/^https:\/\/prewww1\.aeat\.es\//.test(action), `form points at "${action}"`);
      const enc = await c.evaluate(`document.querySelector('form.send').enctype`);
      assert(enc === 'text/plain',
        `enctype must be text/plain or the body is percent-encoded and unparseable, got "${enc}"`);
      const carriesEnvelope = await c.evaluate(
        `document.querySelector('form.send input').name.includes('RegFactuSistemaFacturacion')`);
      assert(carriesEnvelope, 'the field name does not carry the envelope');
      const emptyValue = await c.evaluate(`document.querySelector('form.send input').value === ''`);
      assert(emptyValue, 'the value must stay empty — anything in it lands before the closing tag');
    })(client);

    await check('nothing submits the form on the page behalf', async c => {
      // The certificate prompt is the human's moment. A tool that could submit
      // this form would be arranging for a person to sign without deciding to.
      const src = await c.evaluate(
        `[...document.querySelectorAll('script')].map(s => s.textContent).join('')`);
      assert(!/\.submit\(\)/.test(src), 'something in the page calls form.submit()');
      const inline = await c.evaluate(
        `document.querySelector('form.send').getAttribute('onsubmit')`);
      assert(!inline, 'the form has an inline submit handler');
    })(client);

    await check('every submission result names the test environment', async c => {
      const body = c.text(await c.invoke('export_submission', { invoiceId: 'DEMO-2026-002' }));
      assert(/test environment/i.test(body), `the result did not say where it goes:\n${body}`);
      assert(/prewww1\.aeat\.es/.test(body), `no endpoint in the result:\n${body}`);
    })(client);

    await check('nothing generated ever names the production endpoint', async c => {
      // Records sent to production become a real declared invoicing chain under a
      // real tax identity. Invented invoices must not be able to reach it, so the
      // app never names it and this asserts the whole rendered page does not either.
      await switchMode(c, 'demo');
      await c.invoke('export_submission', { invoiceId: 'DEMO-2026-002' });
      const page = await c.evaluate(`document.body.innerHTML`);
      assert(!/www1\.agenciatributaria\.gob\.es/.test(page),
        'the production endpoint appears somewhere on the page');
      assert(/prewww1\.aeat\.es/.test(page), 'the test endpoint is not named either — check the render');
    })(client);

    await check('every tax ID on screen comes from the AEAT test census', async c => {
      // Sample invoices must not carry a real person or company's tax identity.
      // An earlier version billed an invented amount to a real municipality's NIF.
      const shown = await c.evaluate(
        `[...document.querySelectorAll('.invoice .nif')].map(e => e.textContent.trim()).join(',')`);
      const ids = shown.split(',').filter(Boolean);
      assert(ids.length > 0, 'no client tax IDs rendered');
      assert(ids.every(id => /^8989000\d[A-Z]$/.test(id)),
        `these are outside the AEAT test block: ${ids.filter(i => !/^8989000\d[A-Z]$/.test(i))}`);
    })(client);

    await check('a person can issue an invoice without an agent', async c => {
      // If the agent could do something the person cannot, the person would not
      // really be the one in charge.
      await switchMode(c, 'demo');
      const before = Number(await c.evaluate(`document.getElementById('invoices').dataset.count`));
      await c.evaluate(`document.getElementById('open-new-invoice').click()`);
      const open = await c.evaluate(`document.getElementById('new-invoice').open`);
      assert(open, 'the New invoice dialog did not open');

      await c.evaluate(`(() => {
        const f = document.getElementById('new-invoice-form');
        f.clientName.value = 'By Hand SL';
        f.clientNif.value = '89890003T';
        f.baseEuros.value = '300';
        f.issuedOn.value = '2026-08-28';
      })()`);
      await c.evaluate(`document.getElementById('save-new-invoice').click()`);
      await settle(700);

      const after = Number(await c.evaluate(`document.getElementById('invoices').dataset.count`));
      assert(after === before + 1, `invoice count went ${before} -> ${after}`);
      const shown = await c.evaluate(
        `[...document.querySelectorAll('.invoice .client')].map(e => e.textContent).join('|')`);
      assert(shown.includes('By Hand SL'), `the hand-written invoice is not on screen: ${shown}`);
      const closed = await c.evaluate(`!document.getElementById('new-invoice').open`);
      assert(closed, 'the dialog stayed open after saving');
    })(client);

    await check('the form refuses what the tool refuses, in the same words', async c => {
      await c.evaluate(`document.getElementById('open-new-invoice').click()`);
      await c.evaluate(`(() => {
        const f = document.getElementById('new-invoice-form');
        f.clientName.value = 'Zero SL';
        f.clientNif.value = '89890004R';
        f.baseEuros.value = '100';
        f.vatRate.value = '0';
        f.vatRate.dispatchEvent(new Event('change'));
      })()`);
      const asks = await c.evaluate(`!document.getElementById('treatment-field').hidden`);
      assert(asks, 'choosing 0% did not reveal the reason field');

      await c.evaluate(`document.getElementById('save-new-invoice').click()`);
      await settle(500);
      const err = await c.evaluate(`document.getElementById('new-invoice-error').textContent`);
      assert(/exempt/i.test(err) && /outside the scope/i.test(err),
        `the refusal did not explain itself: "${err}"`);
      await c.evaluate(`document.getElementById('cancel-new-invoice').click()`);
    })(client);

    await check('a person can work out the VAT return without an agent', async c => {
      await c.evaluate(`document.querySelector('[data-tab="vat-return"]').click()`);
      await c.evaluate(`(() => {
        const f = document.getElementById('pick-quarter');
        f.quarter.value = '3'; f.year.value = '2026';
        f.dispatchEvent(new Event('submit', { cancelable: true }));
      })()`);
      await settle(500);
      const boxes = Number(await c.evaluate(`document.getElementById('vat-return').dataset.boxes`));
      assert(boxes > 10, `only ${boxes} boxes rendered from the picker`);
    })(client);

    await check('a person can prepare a submission without an agent', async c => {
      await c.evaluate(`document.querySelector('[data-tab="invoices"]').click()`);
      await c.evaluate(`document.querySelector('[data-prepare]').click()`);
      await settle(600);
      const envelope = await c.evaluate(
        `document.querySelector('#submission .envelope code')?.textContent ?? ''`);
      assert(envelope.includes('RegFactuSistemaFacturacion'),
        'the Prepare button produced no envelope');
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
