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
          ${inv.previousHash ? `<p class="hash"><span>Chained to</span><code>${inv.previousHash}</code></p>`
            : inv.hash ? '<p class="hash"><span>Chained to</span><code class="none">first record in the chain</code></p>' : ''}
        </div>
        ${qr ? `<figure class="qr">${qr}<figcaption>QR tributario</figcaption></figure>` : ''}
      </article>`;
  }));

  host.innerHTML = cards.join('');
}

/** Flash the region an agent just changed, so the human notices it moved. */
export function highlight(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('touched');
  void el.offsetWidth;
  el.classList.add('touched');
}
