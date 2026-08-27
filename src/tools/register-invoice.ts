import { text, type ToolDefinition } from '../lib/webmcp';
import { getMode, getProfile, isProfileComplete, listInvoices, addInvoice } from '../lib/db';
import { modeNotice, NEVER_SUBMITS } from '../lib/mode';
import { buildInvoice, nextSerial, registerInvoice, isVatRate, type VatRate } from '../lib/invoicing';
import { isExemptionCode, isNotSubjectCode, EXEMPTION_CODES } from '../lib/soap';
import { formatAmount, formatTimestamp } from '../lib/verifactu';
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
          + 'E1 to E8 if the operation is exempt, N1 or N2 if it is outside the scope of VAT. '
          + 'Ask the person; it cannot be inferred from the amount.',
        enum: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'N1', 'N2'],
      },
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

    // An invoice charging no VAT has to say why, and this is the moment to ask:
    // the person is thinking about this invoice now. Asking later, when the record
    // is being submitted, means asking about something they filed away days ago.
    if (rate === 0 && !input.vatTreatment) {
      return text(
        `${modeNotice(mode)} Not registered. An invoice charging no VAT has to record why, and `
        + 'that cannot be worked out from the amount.\n\n'
        + 'If 0% was not what you meant, call this again without vatRate — the ordinary rate is 21%.\n\n'
        + `If the invoice genuinely charges no VAT, ask the person whether the operation is exempt `
        + `(${EXEMPTION_CODES.join(', ')}) or outside the scope of VAT (N1, N2), and pass it as `
        + 'vatTreatment.',
      );
    }
    if (rate === 0 && input.vatTreatment
        && !isExemptionCode(input.vatTreatment) && !isNotSubjectCode(input.vatTreatment)) {
      return text(
        `${modeNotice(mode)} "${input.vatTreatment}" is not a VAT treatment code. `
        + `Use one of ${EXEMPTION_CODES.join(', ')}, N1 or N2.`);
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
      {
        clientName: input.clientName, clientNif: input.clientNif, baseEuros: input.baseEuros,
        vatRate: rate as VatRate, issuedOn, vatTreatment: input.vatTreatment,
      },
      serial, mode,
    );
    const registered = await registerInvoice(draft, profile, previousHash, formatTimestamp(now));
    await addInvoice(registered.invoice);

    await renderInvoices(await listInvoices(mode), profile.nif, registered.invoice.id);
    highlight('invoices');

    return text(
      `${modeNotice(mode)} Invoice ${serial} registered.\n`
      + `Client: ${input.clientName} (${input.clientNif})\n`
      + `Base: ${formatAmount(draft.baseCents)} EUR · VAT ${rate}%${input.vatTreatment ? ` (${input.vatTreatment})` : ''}: ${formatAmount(draft.vatCents)} EUR · `
      + `Total: ${formatAmount(draft.totalCents)} EUR\n`
      + `Issued: ${issuedOn}\n`
      + `Fingerprint: ${registered.record.hash}\n`
      + `Chained to: ${previousHash || '(none — this is the first record in the chain)'}\n`
      + `QR: ${registered.qrUrl}\n\n`
      + `${NEVER_SUBMITS} The QR points at the AEAT external test endpoint, not production.`,
    );
  },
};
