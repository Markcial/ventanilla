/**
 * The page is the shared surface. When a tool runs, the person watching sees the
 * same thing the agent produced — that is the whole point of doing this in the
 * browser instead of behind an MCP server.
 */
import type { Obligation, Profile } from './types';
import { type Mode, MODE_BLURB } from './mode';

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

/** Flash the region an agent just changed, so the human notices it moved. */
export function highlight(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('touched');
  void el.offsetWidth;
  el.classList.add('touched');
}
