/**
 * The operations themselves, with no opinion about who asked.
 *
 * A tool and a button both call these. That is deliberate: if the agent could do
 * something the person cannot, the person would not really be in charge — and the
 * page would be a demo wearing a UI rather than an application an agent happens to
 * be able to drive.
 *
 * Each returns a discriminated result rather than throwing, because both callers
 * need to explain a refusal: the tool in words, the form next to the field.
 */
import type { Invoice, Profile } from './types';
import type { Mode } from './mode';
import { getMode, getProfile, isProfileComplete, listInvoices, addInvoice } from './db';
import { buildInvoice, nextSerial, registerInvoice, isVatRate, type VatRate } from './invoicing';
import { formatTimestamp } from './verifactu';
import { buildVatReturn, casillas, type VatReturn } from './vat-return';
import {
  buildSubmissionEnvelope, submissionInstructions, TEST_ENDPOINT,
  isExemptionCode, isNotSubjectCode, EXEMPTION_CODES, type TaxTreatment,
} from './soap';

export type Result<T> =
  | { ok: true; value: T; mode: Mode }
  | { ok: false; reason: string; mode: Mode };

const fail = (mode: Mode, reason: string): Result<never> => ({ ok: false, reason, mode });

export interface NewInvoice {
  clientName: string;
  clientNif: string;
  baseEuros: number;
  vatRate?: number;
  issuedOn?: string;
  vatTreatment?: string;
}

export interface CreatedInvoice {
  invoice: Invoice;
  previousHash: string;
  invoices: Invoice[];
  profile: Profile;
}

/** Issue an invoice, fingerprint it, and chain it to the last one. */
export async function createInvoice(input: NewInvoice): Promise<Result<CreatedInvoice>> {
  const mode = await getMode();
  const profile = await getProfile(mode);

  if (!isProfileComplete(profile)) {
    return fail(mode, 'This profile has no name or tax ID. An invoice carries the issuer\'s '
      + 'identity, so it cannot be invented — fill in your details first.');
  }

  const rate = input.vatRate ?? 21;
  if (!isVatRate(rate)) {
    return fail(mode, `${rate}% is not a Spanish VAT rate. Use 0, 4, 10 or 21.`);
  }
  if (!(input.baseEuros > 0)) {
    return fail(mode, 'The amount before VAT must be greater than zero.');
  }

  // Asked here, while the operation is still in mind. Deferring it to submission
  // means asking about an invoice filed away days ago.
  if (rate === 0 && !input.vatTreatment) {
    return fail(mode, 'An invoice charging no VAT has to record why, and that cannot be worked '
      + `out from the amount. Either the operation is exempt (${EXEMPTION_CODES.join(', ')}) or `
      + 'it is outside the scope of VAT (N1, N2). If 0% was not what you meant, leave the rate '
      + 'out — the ordinary rate is 21%.');
  }
  if (rate === 0 && input.vatTreatment
      && !isExemptionCode(input.vatTreatment) && !isNotSubjectCode(input.vatTreatment)) {
    return fail(mode, `"${input.vatTreatment}" is not a VAT treatment code. `
      + `Use one of ${EXEMPTION_CODES.join(', ')}, N1 or N2.`);
  }

  const now = new Date();
  const issuedOn = input.issuedOn || now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn)) {
    return fail(mode, `"${issuedOn}" is not a date in yyyy-mm-dd form.`);
  }

  const existing = await listInvoices(mode);
  const previousHash = existing.at(-1)?.hash ?? '';
  const serial = nextSerial(existing, Number(issuedOn.slice(0, 4)), mode);

  const draft = buildInvoice({
    clientName: input.clientName, clientNif: input.clientNif, baseEuros: input.baseEuros,
    vatRate: rate as VatRate, issuedOn, vatTreatment: input.vatTreatment,
  }, serial, mode);

  const registered = await registerInvoice(draft, profile, previousHash, formatTimestamp(now));
  await addInvoice(registered.invoice);

  return {
    ok: true, mode,
    value: {
      invoice: registered.invoice,
      previousHash,
      invoices: await listInvoices(mode),
      profile,
    },
  };
}

export interface ComputedReturn {
  vat: VatReturn;
  boxes: ReturnType<typeof casillas>;
  invoiceCount: number;
}

/** Work out modelo 303 for a quarter. */
export async function computeVatReturn(year: number, quarter: 1 | 2 | 3 | 4): Promise<Result<ComputedReturn>> {
  const mode = await getMode();
  const profile = await getProfile(mode);

  if (!isProfileComplete(profile)) {
    return fail(mode, 'No return can be worked out: this profile has no name or tax ID.');
  }
  if (profile.vatRegime !== 'general') {
    return fail(mode, 'This profile is not on the general VAT regime, and only the general '
      + 'regime is computed here.');
  }

  const invoices = await listInvoices(mode);
  const vat = buildVatReturn(invoices, year, quarter);
  return { ok: true, mode, value: { vat, boxes: casillas(vat), invoiceCount: invoices.length } };
}

export interface PreparedSubmission {
  invoiceId: string;
  filename: string;
  envelope: string;
  endpoint: string;
  instructions: string;
}

/** Build the SOAP request for an invoice already on record. */
export async function prepareSubmission(
  invoiceId: string | undefined,
  softwareVersion: string,
  override?: string,
): Promise<Result<PreparedSubmission>> {
  const mode = await getMode();
  const profile = await getProfile(mode);

  if (!isProfileComplete(profile)) {
    return fail(mode, 'Nothing to submit: this profile has no name or tax ID.');
  }

  const invoices = await listInvoices(mode);
  const index = invoiceId ? invoices.findIndex(i => i.id === invoiceId) : invoices.length - 1;
  if (index < 0) {
    return fail(mode, `No invoice ${invoiceId ? `"${invoiceId}"` : 'at all'} here. `
      + `Registered: ${invoices.map(i => i.id).join(', ') || 'none'}.`);
  }

  const invoice = invoices[index];
  if (!invoice.hash || !invoice.generatedAt) {
    return fail(mode, `${invoice.id} has no stored fingerprint or generation time, so a valid `
      + 'submission cannot be rebuilt from it. Register it again.');
  }

  const stated = override ?? invoice.vatTreatment;
  let taxTreatment: TaxTreatment;
  if (invoice.vatRate > 0) {
    taxTreatment = { kind: 'subject' };
  } else if (!stated) {
    return fail(mode, `${invoice.id} charges no VAT and does not record why. Ask whether the `
      + `operation is exempt (${EXEMPTION_CODES.join(', ')}) or outside the scope (N1, N2).`);
  } else if (isExemptionCode(stated)) {
    taxTreatment = { kind: 'exempt', code: stated };
  } else if (isNotSubjectCode(stated)) {
    taxTreatment = { kind: 'notSubject', code: stated };
  } else {
    return fail(mode, `"${stated}" is not a VAT treatment code.`);
  }

  const envelope = buildSubmissionEnvelope({
    invoice, profile,
    previous: index > 0 ? invoices[index - 1] : null,
    generatedAt: invoice.generatedAt,
    softwareVersion, taxTreatment,
  });
  const filename = `${invoice.id.replace(/\//g, '-')}-verifactu.xml`;

  return {
    ok: true, mode,
    value: {
      invoiceId: invoice.id, filename, envelope,
      endpoint: TEST_ENDPOINT,
      instructions: submissionInstructions(TEST_ENDPOINT, filename),
    },
  };
}
