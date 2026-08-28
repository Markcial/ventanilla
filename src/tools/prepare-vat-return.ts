import { text, type ToolDefinition } from '../lib/webmcp';
import { modeNotice } from '../lib/mode';
import { today } from '../lib/db';
import { quarterOf } from '../lib/vat-return';
import { computeVatReturn } from '../lib/actions';
import { renderVatReturn } from '../lib/render';

interface Input { quarter?: number; year?: number }

/** The AEAT's own preproduction form for the 2026 model. No fiscal effect. */
export const PRE_303_FORM = 'https://prewww2.aeat.es/wlpl/A303-FWME/E2026/OPEN/index.zul';

/**
 * Work out the quarterly VAT return from the invoices already recorded.
 *
 * It stops at the boxes because that is where the channel stops: since 2023 the
 * model is filed through a web form and there is no file format for the current
 * year, so a person transcribes it and signs.
 *
 * Shares lib/actions with the page's own Work it out button.
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
    const now = today();
    const year = input.year ?? Number(now.slice(0, 4));
    const quarter = (input.quarter ?? Math.max(1, quarterOf(now) - 1)) as 1 | 2 | 3 | 4;

    const result = await computeVatReturn(year, quarter);
    if (!result.ok) return text(`${modeNotice(result.mode)} ${result.reason}`);

    const { vat, boxes, invoiceCount } = result.value;
    renderVatReturn({ vat, boxes, formUrl: PRE_303_FORM, invoiceCount });

    const money = (cents: number) => (cents / 100).toFixed(2);
    return text(
      `${modeNotice(result.mode)} Modelo 303, ${vat.period} ${year}, on screen and ready to transcribe.\n`
      + `${vat.rows.length} rate row(s) from the invoices of that quarter.\n\n`
      + `${boxes.map(b => `  [${b.number}] ${b.label}: ${b.value}`).join('\n')}\n\n`
      + `Result: ${money(vat.resultCents)} EUR to pay.\n\n`
      + (vat.excluded.length
        ? `Left out:\n${vat.excluded.map(e => `  ${e.id} — ${e.reason}`).join('\n')}\n\n` : '')
      + `What this return does not know:\n${vat.caveats.map(c => `  - ${c}`).join('\n')}\n\n`
      + 'Since 2023 the model is filed through a web form and there is no file format for the '
      + `current year, so this cannot be uploaded. Transcribe the boxes into ${PRE_303_FORM} `
      + '— the AEAT preproduction form, which has no fiscal effect — and sign with your certificate.',
    );
  },
};
