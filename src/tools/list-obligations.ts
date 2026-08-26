import { text, type ToolDefinition } from '../lib/webmcp';
import { getMode, getProfile, isProfileComplete, today } from '../lib/db';
import { modeNotice } from '../lib/mode';
import { upcomingObligations } from '../lib/obligations';
import { renderObligations, highlight } from '../lib/render';

interface Input { withinDays?: number }

/**
 * Passes the three-part test this project applies to every tool:
 * it needs state a chatbot does not have (when the person started trading, their
 * VAT regime), it changes what is on screen, and the person can check the result
 * against the dates shown.
 */
export const listObligations: ToolDefinition<Input> = {
  name: 'list_obligations',
  title: 'List upcoming tax obligations',
  description:
    'List the tax forms this freelancer still has to file, with deadlines, soonest first. '
    + 'Uses their registration date, VAT regime and income tax method, so results are specific '
    + 'to them rather than general advice. Also displays the list on the page.',
  inputSchema: {
    type: 'object',
    properties: {
      withinDays: {
        type: 'integer',
        description: 'Only include obligations due within this many days. Defaults to 365.',
        minimum: 1,
        maximum: 730,
      },
    },
  },
  annotations: { readOnlyHint: true },
  execute: async ({ withinDays = 365 } = {}) => {
    const mode = await getMode();
    const profile = await getProfile(mode);

    // Real mode never borrows demo data to fill a gap. Answering with someone
    // else's registration date would produce confident, wrong deadlines.
    if (!isProfileComplete(profile)) {
      return text(
        `${modeNotice(mode)} No deadlines can be worked out yet: this profile has no `
        + 'registration date, tax ID or name. The person needs to fill those in on the page — '
        + 'an agent cannot supply them, and guessing would produce wrong deadlines.',
      );
    }

    const now = today();
    const obligations = upcomingObligations(profile, now, withinDays);

    renderObligations(obligations);
    highlight('obligations');

    if (obligations.length === 0) {
      return text(`${modeNotice(mode)} Nothing due within ${withinDays} days (checked on ${now}).`);
    }

    const lines = obligations.map(o =>
      `- ${o.form} (${o.periodLabel}) — ${o.title}. Due ${o.dueDate}, `
      + `${o.daysRemaining} days away. By direct debit: ${o.directDebitDueDate}. ${o.reason}`);

    return text(
      `${modeNotice(mode)} ${obligations.length} obligation(s) due within ${withinDays} days, `
      + `as of ${now}:\n${lines.join('\n')}\n\n`
      + 'Deadlines move to the next working day when they fall on a weekend. '
      + 'Public holidays are not applied.',
    );
  },
};
