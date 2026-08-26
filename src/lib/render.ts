/**
 * The page is the shared surface. When a tool runs, the person watching sees the
 * same thing the agent produced — that is the whole point of doing this in the
 * browser instead of behind an MCP server.
 */
import type { Obligation } from './types';

export function renderObligations(obligations: Obligation[]): void {
  const host = document.getElementById('obligations');
  if (!host) return;

  host.dataset.count = String(obligations.length);

  if (obligations.length === 0) {
    host.innerHTML = '<p class="empty">Nothing due in that window.</p>';
    return;
  }

  host.innerHTML = obligations.map(o => `
    <article class="obligation${o.daysRemaining <= 30 ? ' soon' : ''}" data-form="${o.form}">
      <header>
        <h3>${o.form} <span class="period">${o.periodLabel}</span></h3>
        <span class="days">${o.daysRemaining} days</span>
      </header>
      <p class="title">${o.title}</p>
      <dl>
        <dt>Filing window</dt><dd>${o.windowOpens} → ${o.dueDate}</dd>
        <dt>By direct debit</dt><dd>${o.directDebitDueDate}</dd>
      </dl>
      <p class="reason">${o.reason}</p>
    </article>
  `).join('');
}

/** Flash the region an agent just changed, so the human notices it moved. */
export function highlight(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('touched');
  void el.offsetWidth;
  el.classList.add('touched');
}
