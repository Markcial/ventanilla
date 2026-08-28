import { text, type ToolDefinition } from '../lib/webmcp';
import { modeNotice, NEVER_SUBMITS } from '../lib/mode';
import { createInvoice } from '../lib/actions';
import { buildQrUrl, formatInvoiceDate } from '../lib/verifactu';
import { EXEMPTION_CODES } from '../lib/soap';
import { formatAmount } from '../lib/verifactu';
import { renderInvoices, highlight } from '../lib/render';

interface Input {
  clientName: string;
  clientNif: string;
  baseEuros: number;
  vatRate?: number;
  issuedOn?: string;
  vatTreatment?: string;
}

/**
 * The tool the whole project is really about.
 *
 * It needs prior state a chatbot cannot have — the fingerprint of the last invoice,
 * which is what the new record chains to. It produces an artifact. And the person
 * checks it on the page rather than trusting a sentence.
 *
 * The work itself lives in lib/actions, which the page's own New invoice form calls
 * too. An agent doing something the person could not do would be the wrong shape.
 */
export const registerInvoiceTool: ToolDefinition<Input> = {
  name: 'register_invoice',
  title: 'Register an invoice',
  description:
    'Record a new issued invoice and generate its Verifactu record: the serial number, the '
    + 'SHA-256 fingerprint chained to the previous invoice, and the QR code contents. '
    + 'Give the client name, their tax ID, and the amount before VAT. '
    + 'The invoice appears on the page for the person to check.',
  inputSchema: {
    type: 'object',
    properties: {
      clientName: { type: 'string', description: 'Who the invoice is billed to.' },
      clientNif: { type: 'string', description: "The client's Spanish tax ID (NIF/CIF)." },
      baseEuros: { type: 'number', description: 'Amount before VAT, in euros.', exclusiveMinimum: 0 },
      vatRate: {
        type: 'integer',
        description:
          'VAT rate as a percentage. Leave it out for the ordinary 21% rate. '
          + 'Use 10 or 4 for the reduced rates. Use 0 only when the invoice genuinely charges '
          + 'no VAT, which also requires vatTreatment — do not pass 0 just to fill the field in.',
        enum: [21, 10, 4, 0],
      },
      issuedOn: { type: 'string', description: 'Issue date as yyyy-mm-dd. Defaults to today.' },
      vatTreatment: {
        type: 'string',
        description:
          'Required when vatRate is 0, and only then: why no VAT is charged. '
          + `${EXEMPTION_CODES.join(', ')} if the operation is exempt, N1 or N2 if it is outside `
          + 'the scope of VAT. Ask the person; it cannot be inferred from the amount.',
        enum: [...EXEMPTION_CODES, 'N1', 'N2'],
      },
    },
    required: ['clientName', 'clientNif', 'baseEuros'],
  },
  annotations: { readOnlyHint: false },
  execute: async input => {
    const result = await createInvoice(input);
    if (!result.ok) return text(`${modeNotice(result.mode)} Not registered. ${result.reason}`);

    const { invoice, previousHash, invoices, profile } = result.value;
    await renderInvoices(invoices, profile.nif, invoice.id);
    highlight('invoices');

    return text(
      `${modeNotice(result.mode)} Invoice ${invoice.id} registered.\n`
      + `Client: ${invoice.clientName} (${invoice.clientNif})\n`
      + `Base: ${formatAmount(invoice.baseCents)} EUR · VAT ${invoice.vatRate}%`
      + `${invoice.vatTreatment ? ` (${invoice.vatTreatment})` : ''}: ${formatAmount(invoice.vatCents)} EUR · `
      + `Total: ${formatAmount(invoice.totalCents)} EUR\n`
      + `Issued: ${invoice.issuedOn}\n`
      + `Fingerprint: ${invoice.hash}\n`
      + `Chained to: ${previousHash || '(none — this is the first record in the chain)'}\n`
      + `QR: ${buildQrUrl({
        nif: profile.nif,
        numserie: invoice.id,
        fecha: formatInvoiceDate(invoice.issuedOn),
        importe: formatAmount(invoice.totalCents),
      })}\n\n`
      + NEVER_SUBMITS,
    );
  },
};
