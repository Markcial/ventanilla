import { text, type ToolDefinition } from '../lib/webmcp';
import { getMode, getProfile, isProfileComplete, listInvoices, today } from '../lib/db';
import { modeNotice } from '../lib/mode';
import { buildVatReturn, casillas, quarterOf } from '../lib/vat-return';
import { renderVatReturn } from '../lib/render';

interface Input { quarter?: number; year?: number }

/** The AEAT's own preproduction form for the 2026 model. No fiscal effect. */
export const PRE_303_FORM = 'https://prewww2.aeat.es/wlpl/A303-FWME/E2026/OPEN/index.zul';

/**
 * Work out the quarterly VAT return from the invoices already recorded.
 *
 * Needs state no chatbot has — every invoice of the quarter, at its own rate —
 * produces a document, and the person checks the boxes against the invoices in
 * front of them before typing them into the tax agency's form.
 *
 * It stops at the boxes. Since 2023 the model is filed through a web form and
 * there is no file format for the current year, so nothing here can be uploaded:
 * a person transcribes it and signs. That is the same boundary as everywhere
 * else in this app, arrived at from a different direction.
 */
export const prepareVatReturn: ToolDefinition<Input> = {
  name: 'prepare_vat_return',
  title: 'Prepare the quarterly VAT return',
  description:
    'Work out modelo 303, the Spanish quarterly VAT return, from the invoices recorded here. '
    + 'Returns the numbered boxes of the official form ready to transcribe, and shows them on the '
    + 'page. Defaults to the quarter that has most recently ended. Says what it could not compute '
    + 'rather than guessing.',
  inputSchema: {
    type: 'object',
    properties: {
      quarter: { type: 'integer', description: 'Quarter, 1 to 4. Defaults to the last completed one.', minimum: 1, maximum: 4 },
      year: { type: 'integer', description: 'Four-digit year. Defaults to the current one.', minimum: 2000, maximum: 2100 },
    },
  },
  annotations: { readOnlyHint: true },
  execute: async (input = {} as Input) => {
    const mode = await getMode();
    const profile = await getProfile(mode);

    if (!isProfileComplete(profile)) {
      return text(`${modeNotice(mode)} No return can be worked out: this profile has no name or tax ID.`);
    }
    if (profile.vatRegime !== 'general') {
      return text(
        `${modeNotice(mode)} This profile is not on the general VAT regime, and only the general `
        + 'regime is computed here.');
    }

    const now = today();
    const year = input.year ?? Number(now.slice(0, 4));
    const quarter = (input.quarter ?? Math.max(1, quarterOf(now) - 1)) as 1 | 2 | 3 | 4;

    const invoices = await listInvoices(mode);
    const vat = buildVatReturn(invoices, year, quarter);
    const boxes = casillas(vat);

    renderVatReturn({ vat, boxes, formUrl: PRE_303_FORM, invoiceCount: invoices.length });

    const money = (cents: number) => (cents / 100).toFixed(2);
    const lines = boxes.map(b => `  [${b.number}] ${b.label}: ${b.value}`);

    return text(
      `${modeNotice(mode)} Modelo 303, ${vat.period} ${year}, on screen and ready to transcribe.\n`
      + `${vat.rows.length} rate row(s) from the invoices of that quarter.\n\n`
      + `${lines.join('\n')}\n\n`
      + `Result: ${money(vat.resultCents)} EUR to pay.\n\n`
      + (vat.excluded.length
        ? `Left out:\n${vat.excluded.map(e => `  ${e.id} — ${e.reason}`).join('\n')}\n\n`
        : '')
      + `What this return does not know:\n${vat.caveats.map(c => `  - ${c}`).join('\n')}\n\n`
      + `Since 2023 the model is filed through a web form and there is no file format for the `
      + `current year, so this cannot be uploaded. Transcribe the boxes into ${PRE_303_FORM} `
      + `— the AEAT preproduction form, which has no fiscal effect — and sign with your certificate.`,
    );
  },
};
