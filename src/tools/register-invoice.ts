import { text, type ToolDefinition } from '../lib/webmcp';
import { getMode, getProfile, isProfileComplete, listInvoices, addInvoice } from '../lib/db';
import { modeNotice, NEVER_SUBMITS } from '../lib/mode';
import { buildInvoice, nextSerial, registerInvoice, isVatRate, type VatRate } from '../lib/invoicing';
import { formatAmount, formatTimestamp } from '../lib/verifactu';
import { renderInvoices, highlight } from '../lib/render';

interface Input {
  clientName: string;
  clientNif: string;
  baseEuros: number;
  vatRate?: number;
  issuedOn?: string;
}

/**
 * The tool the whole project is really about.
 *
 * It needs prior state a chatbot cannot have — the fingerprint of the last
 * invoice, which is what the new record chains to. It produces an artifact: a
 * numbered invoice with a Verifactu record and its QR. And the person checks it
 * on the page rather than trusting a sentence.
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
      vatRate: { type: 'integer', description: 'VAT rate: 0, 4, 10 or 21. Defaults to 21.', enum: [0, 4, 10, 21] },
      issuedOn: { type: 'string', description: 'Issue date as yyyy-mm-dd. Defaults to today.' },
    },
    required: ['clientName', 'clientNif', 'baseEuros'],
  },
  annotations: { readOnlyHint: false },
  execute: async input => {
    const mode = await getMode();
    const profile = await getProfile(mode);

    if (!isProfileComplete(profile)) {
      return text(
        `${modeNotice(mode)} Cannot issue an invoice: this profile has no name or tax ID. `
        + 'The person needs to fill those in on the page first — an invoice carries their '
        + 'identity, so an agent must not invent it.',
      );
    }

    const rate = input.vatRate ?? 21;
    if (!isVatRate(rate)) {
      return text(`${modeNotice(mode)} ${rate}% is not a Spanish VAT rate. Use 0, 4, 10 or 21.`);
    }
    if (!(input.baseEuros > 0)) {
      return text(`${modeNotice(mode)} The amount before VAT must be greater than zero.`);
    }

    const now = new Date();
    const issuedOn = input.issuedOn ?? now.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn)) {
      return text(`${modeNotice(mode)} "${issuedOn}" is not a date in yyyy-mm-dd form.`);
    }

    const existing = await listInvoices(mode);
    // The chain continues from the most recent invoice, not from nothing.
    const previousHash = existing.at(-1)?.hash ?? '';
    const serial = nextSerial(existing, Number(issuedOn.slice(0, 4)), mode);

    const draft = buildInvoice(
      { clientName: input.clientName, clientNif: input.clientNif, baseEuros: input.baseEuros, vatRate: rate as VatRate, issuedOn },
      serial, mode,
    );
    const registered = await registerInvoice(draft, profile, previousHash, formatTimestamp(now));
    await addInvoice(registered.invoice);

    await renderInvoices(await listInvoices(mode), profile.nif, registered.invoice.id);
    highlight('invoices');

    return text(
      `${modeNotice(mode)} Invoice ${serial} registered.\n`
      + `Client: ${input.clientName} (${input.clientNif})\n`
      + `Base: ${formatAmount(draft.baseCents)} EUR · VAT ${rate}%: ${formatAmount(draft.vatCents)} EUR · `
      + `Total: ${formatAmount(draft.totalCents)} EUR\n`
      + `Issued: ${issuedOn}\n`
      + `Fingerprint: ${registered.record.hash}\n`
      + `Chained to: ${previousHash || '(none — this is the first record in the chain)'}\n`
      + `QR: ${registered.qrUrl}\n\n`
      + `${NEVER_SUBMITS} The QR points at the AEAT external test endpoint, not production.`,
    );
  },
};
