/**
 * Turning an invoice into a chained, fingerprinted Verifactu record.
 *
 * Sits between the pure spec code in verifactu.ts and the tool, so the tool
 * stays glue and the arithmetic stays testable.
 */
import type { Invoice, Profile } from './types';
import type { Mode } from './mode';
import { buildAltaRecord, formatAmount, formatInvoiceDate, buildQrUrl, type AltaRecord } from './verifactu';

export const VAT_RATES = [0, 4, 10, 21] as const;
export type VatRate = typeof VAT_RATES[number];

export function isVatRate(value: number): value is VatRate {
  return (VAT_RATES as readonly number[]).includes(value);
}

/** Euro amount as cents, so money never touches floating point after this point. */
export function toCents(euros: number): number {
  return Math.round(euros * 100);
}

export interface DraftInvoice {
  clientName: string;
  clientNif: string;
  baseEuros: number;
  vatRate: VatRate;
  issuedOn: string;
}

/**
 * Next serial in the series, continuing from what is already stored.
 *
 * Verifactu chains records, so a gap or a reused serial is not a cosmetic
 * problem — it breaks the chain.
 */
export function nextSerial(existing: Invoice[], year: number, mode: Mode): string {
  const prefix = mode === 'demo' ? 'DEMO' : 'F';
  const used = existing
    .map(i => new RegExp(`^${prefix}-${year}-(\\d+)$`).exec(i.id))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => Number(m[1]));
  const next = used.length ? Math.max(...used) + 1 : 1;
  return `${prefix}-${year}-${String(next).padStart(3, '0')}`;
}

export function buildInvoice(draft: DraftInvoice, serial: string, mode: Mode): Invoice {
  const baseCents = toCents(draft.baseEuros);
  const vatCents = Math.round(baseCents * draft.vatRate / 100);
  return {
    id: serial,
    mode,
    issuedOn: draft.issuedOn,
    clientName: draft.clientName,
    clientNif: draft.clientNif,
    baseCents,
    vatRate: draft.vatRate,
    vatCents,
    totalCents: baseCents + vatCents,
  };
}

export interface RegisteredInvoice {
  invoice: Invoice;
  record: AltaRecord;
  qrUrl: string;
}

/** Fingerprint an invoice, chain it to the last one, and build its QR contents. */
export async function registerInvoice(
  invoice: Invoice,
  profile: Profile,
  previousHash: string,
  generatedAt: string,
): Promise<RegisteredInvoice> {
  const record = await buildAltaRecord(invoice, profile, previousHash, generatedAt);
  return {
    invoice: { ...invoice, hash: record.hash, previousHash: record.previousHash },
    record,
    qrUrl: buildQrUrl({
      nif: profile.nif,
      numserie: invoice.id,
      fecha: formatInvoiceDate(invoice.issuedOn),
      importe: formatAmount(invoice.totalCents),
    }),
  };
}
