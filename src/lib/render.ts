/**
 * The page is the shared surface. When a tool runs, the person watching sees the
 * same thing the agent produced — that is the whole point of doing this in the
 * browser instead of behind an MCP server.
 */
import QRCode from 'qrcode';
import type { Obligation, Profile, Invoice } from './types';
import { type Mode, MODE_BLURB } from './mode';
import { formatAmount, formatInvoiceDate, buildQrUrl } from './verifactu';

function escape(value: string): string {
  return value.replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function renderObligations(obligations: Obligation[]): void {
  const host = document.getElementById('obligations');
  if (!host) return;

  host.dataset.count = String(obligations.length);
  focusTab('deadlines');

  if (obligations.length === 0) {
    host.innerHTML = '<p class="empty">Nothing due in that window.</p>';
    return;
  }

  host.innerHTML = obligations.map(o => `
    <article class="obligation${o.daysRemaining <= 30 ? ' soon' : ''}" data-form="${escape(o.form)}">
      <header>
        <h3>${escape(o.form)} <span class="period">${escape(o.periodLabel)}</span></h3>
        <span class="days">${o.daysRemaining}d</span>
      </header>
      <p class="what">${escape(o.title)}</p>
      <dl>
        <dt>Window</dt><dd>${o.windowOpens} → <strong>${o.dueDate}</strong></dd>
        <dt>Direct debit</dt><dd>${o.directDebitDueDate}</dd>
      </dl>
      <p class="reason">${escape(o.reason)}</p>
    </article>
  `).join('');
}

/** Demo details are read-only; real details are yours to type in. */
export function renderProfile(profile: Profile, mode: Mode): void {
  const host = document.getElementById('profile');
  if (!host) return;
  host.dataset.mode = mode;

  if (mode === 'demo') {
    host.innerHTML = `
      <dl class="facts">
        <dt>Name</dt><dd>${escape(profile.name)}</dd>
        <dt>Tax ID</dt><dd>${escape(profile.nif)}</dd>
        <dt>Trading since</dt><dd>${profile.startedTrading}</dd>
        <dt>VAT</dt><dd>${profile.vatRegime}</dd>
        <dt>Income tax</dt><dd>${profile.incomeTaxMethod === 'direct' ? 'direct assessment' : 'modules'}</dd>
        <dt>Employees</dt><dd>${profile.hasEmployees ? 'yes' : 'no'}</dd>
      </dl>`;
    return;
  }

  host.innerHTML = `
    <form id="profile-form" class="fields">
      <label>Name<input name="name" value="${escape(profile.name)}" autocomplete="off" required /></label>
      <label>Tax ID (NIF)<input name="nif" value="${escape(profile.nif)}" autocomplete="off" required /></label>
      <label>Trading since<input name="startedTrading" type="date" value="${profile.startedTrading}" required /></label>
      <label>VAT regime
        <select name="vatRegime">
          <option value="general"${profile.vatRegime === 'general' ? ' selected' : ''}>General</option>
          <option value="exempt"${profile.vatRegime === 'exempt' ? ' selected' : ''}>Exempt</option>
        </select>
      </label>
      <label>Income tax
        <select name="incomeTaxMethod">
          <option value="direct"${profile.incomeTaxMethod === 'direct' ? ' selected' : ''}>Direct assessment</option>
          <option value="modules"${profile.incomeTaxMethod === 'modules' ? ' selected' : ''}>Modules</option>
        </select>
      </label>
      <label class="check"><input name="hasEmployees" type="checkbox"${profile.hasEmployees ? ' checked' : ''} /> I have employees</label>
      <button type="submit">Save</button>
      <span id="profile-saved" class="saved" hidden>Saved</span>
    </form>`;
}

export function renderModeStrip(mode: Mode): void {
  const strip = document.getElementById('mode-strip');
  if (strip) {
    strip.dataset.mode = mode;
    strip.textContent = MODE_BLURB[mode];
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-set-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.setMode === mode));
  }
  document.body.dataset.mode = mode;
}

/**
 * Invoices, newest first, each with its Verifactu fingerprint and QR.
 *
 * The fingerprint is shown in full rather than truncated: it is the thing that
 * makes the record checkable, and a person who cannot read it cannot check it.
 */
export async function renderInvoices(invoices: Invoice[], issuerNif: string, highlightId?: string): Promise<void> {
  const host = document.getElementById('invoices');
  if (!host) return;

  host.dataset.count = String(invoices.length);
  setTabCount('invoices', invoices.length);
  if (highlightId) focusTab('invoices');

  if (invoices.length === 0) {
    host.innerHTML = '<p class="empty">No invoices yet.</p>';
    return;
  }

  const newest = [...invoices].reverse();
  const cards = await Promise.all(newest.map(async inv => {
    const qr = inv.hash
      ? await QRCode.toString(buildQrUrl({
          nif: issuerNif, numserie: inv.id,
          fecha: formatInvoiceDate(inv.issuedOn),
          importe: formatAmount(inv.totalCents),
        }), { type: 'svg', margin: 1, width: 96, errorCorrectionLevel: 'M' })
      : '';
    return `
      <article class="invoice${inv.id === highlightId ? ' fresh' : ''}" data-id="${escape(inv.id)}">
        ${inv.hash ? (inv.previousHash
          ? `<p class="link"><span class="link-label">links to</span><code>${inv.previousHash}</code></p>`
          : '<p class="link link-root"><span class="link-label">chain starts here</span></p>') : ''}
        <div class="invoice-body">
          <header>
            <h3>${escape(inv.id)}</h3>
            <span class="total">${formatAmount(inv.totalCents)} EUR</span>
          </header>
          <p class="client">${escape(inv.clientName)} <span class="nif">${escape(inv.clientNif)}</span></p>
          <dl>
            <dt>Issued</dt><dd>${inv.issuedOn}</dd>
            <dt>Base</dt><dd>${formatAmount(inv.baseCents)} EUR</dd>
            <dt>VAT ${inv.vatRate}%</dt><dd>${formatAmount(inv.vatCents)} EUR</dd>
          </dl>
          ${inv.hash ? `<p class="hash"><span>Fingerprint</span><code>${inv.hash}</code></p>` : ''}
        </div>
        ${qr ? `<figure class="qr">${qr}<figcaption>QR tributario</figcaption></figure>` : ''}
      </article>`;
  }));

  host.innerHTML = cards.join('');
}

export interface VatReturnView {
  vat: import('./vat-return').VatReturn;
  boxes: Array<{ number: string; label: string; value: string }>;
  formUrl: string;
  invoiceCount: number;
}

/**
 * The return as a sheet of numbered boxes.
 *
 * Laid out to be transcribed: box number first, in the order the form asks, so
 * the eye can run down the two columns side by side. What could not be computed
 * sits above the numbers, not below them, because someone about to file needs to
 * know the return is incomplete before they read a total.
 */
export function renderVatReturn(view: VatReturnView): void {
  const host = document.getElementById('vat-return');
  if (!host) return;

  const { vat, boxes } = view;
  host.dataset.period = `${vat.period}-${vat.year}`;
  host.dataset.boxes = String(boxes.length);
  host.dataset.result = (vat.resultCents / 100).toFixed(2);

  host.innerHTML = `
    <div class="return-head">
      <div>
        <h3>Modelo 303 · ${vat.period} ${vat.year}</h3>
        <p class="endpoint">${vat.rows.length} rate row(s) · ${view.invoiceCount} invoice(s) on record</p>
      </div>
      <p class="result"><span>To pay</span><strong>${(vat.resultCents / 100).toFixed(2)} EUR</strong></p>
    </div>

    <div class="warn">
      <p><strong>Incomplete on purpose.</strong> Check these before filing:</p>
      <ul>${vat.caveats.map(c => `<li>${escape(c)}</li>`).join('')}</ul>
      ${vat.excluded.length ? `<p><strong>Left out of the rate rows:</strong></p><ul>${
        vat.excluded.map(e => `<li>${escape(e.id)} — ${escape(e.reason)}</li>`).join('')}</ul>` : ''}
    </div>

    <table class="boxes">
      <thead><tr><th>Box</th><th>What it is</th><th>Value</th></tr></thead>
      <tbody>${boxes.map(b => `
        <tr><td class="num">[${escape(b.number)}]</td><td>${escape(b.label)}</td><td class="val">${escape(b.value)}</td></tr>
      `).join('')}</tbody>
    </table>

    <h4>Filing it</h4>
    <p class="filing">Since 2023 this model is filed through a web form and there is no file format
      for the current year, so nothing here can be uploaded. Open the form, type the boxes above,
      and sign with your certificate.</p>
    <p><a class="formlink" href="${escape(view.formUrl)}" target="_blank" rel="noopener noreferrer">${escape(view.formUrl)}</a></p>
    <p class="filing">That is the AEAT preproduction form. It behaves like the real one and has no
      fiscal effect.</p>`;

  focusTab('vat-return');
}

export interface SubmissionView {
  invoiceId: string;
  filename: string;
  envelope: string;
  endpoint: string;
  instructions: string;
}

/**
 * Show the prepared submission, and let the person take the file.
 *
 * The envelope is shown in full rather than summarised. It is the artifact being
 * handed over, and a person who cannot read it cannot check it before sending it
 * to their tax agency under their own certificate.
 */
export function renderSubmission(view: SubmissionView): void {
  const host = document.getElementById('submission');
  if (!host) return;

  host.dataset.invoice = view.invoiceId;
  host.innerHTML = `
    <div class="submission-head">
      <div>
        <h3>${escape(view.invoiceId)}</h3>
        <p class="endpoint">${escape(view.endpoint)}</p>
      </div>
      <button id="download-submission" type="button">Download ${escape(view.filename)}</button>
    </div>
    <p class="warn">This goes to the tax agency's test environment. It has no fiscal effect —
      that is what the environment is published for.</p>

    <form class="send" method="POST" enctype="text/plain" target="_blank" action="${escape(view.endpoint)}">
      <input type="hidden" name="${escape(view.envelope)}" value="" />
      <button type="submit">Send it with my certificate</button>
      <p class="send-note">Your browser will ask which certificate to use. Nothing can answer that
        for you — not this page, and not an agent. That prompt is the point.</p>
    </form>
    <pre class="envelope"><code>${escape(view.envelope)}</code></pre>
    <h4>Sending it yourself</h4>
    <pre class="howto"><code>${escape(view.instructions)}</code></pre>`;

  document.getElementById('download-submission')?.addEventListener('click', () => {
    const blob = new Blob([view.envelope], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = view.filename;
    link.click();
    URL.revokeObjectURL(url);
  });

  focusTab('submission');
}

/**
 * Bring a tab forward.
 *
 * Tools call this whenever they write into a panel. If an agent filled in a tab
 * the person could not see, the answer would be off screen and the one thing
 * this project claims — that you watch the work happen — would stop being true.
 */
export function focusTab(name: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-panel]')) {
    panel.hidden = panel.dataset.panel !== name;
  }
}

/** Keep the invoice count in the tab label honest. */
export function setTabCount(name: string, count: number): void {
  const badge = document.querySelector(`[data-tab="${name}"] .count`);
  if (badge) badge.textContent = count > 0 ? String(count) : '';
}

/** Flash the region an agent just changed, so the human notices it moved. */
export function highlight(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('touched');
  void el.offsetWidth;
  el.classList.add('touched');
}
