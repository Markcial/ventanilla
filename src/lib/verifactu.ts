/**
 * Verifactu invoice record fingerprint and chaining (RD 1007/2023).
 *
 * Implemented against the AEAT specification, not from memory:
 * https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf
 * (Veri*Factu, "Algoritmo de cálculo de codificación de la huella o hash", v0.1.2)
 *
 * The three worked examples in section 6 of that document are used verbatim as
 * tests, so this is checkable by anyone against the official vectors rather than
 * being merely plausible.
 *
 * Shape of the thing:
 * - a fixed, ordered set of fields per record type, joined as `name=value&name=value`
 * - no trailing separator after the last field
 * - values trimmed; a missing or empty value leaves `name=` with nothing after it
 * - UTF-8 bytes, SHA-256, output as 64 uppercase hex characters
 * - each record includes the previous record's hash, which is what chains them
 */
import type { Invoice, Profile } from './types';

/** Field order for a "registro de facturación de alta". Order is part of the spec. */
export const ALTA_FIELDS = [
  'IDEmisorFactura',
  'NumSerieFactura',
  'FechaExpedicionFactura',
  'TipoFactura',
  'CuotaTotal',
  'ImporteTotal',
  'Huella',
  'FechaHoraHusoGenRegistro',
] as const;

/** Field order for a "registro de facturación de anulación". */
export const ANULACION_FIELDS = [
  'IDEmisorFacturaAnulada',
  'NumSerieFacturaAnulada',
  'FechaExpedicionFacturaAnulada',
  'Huella',
  'FechaHoraHusoGenRegistro',
] as const;

export type HashFields = Record<string, string | undefined | null>;

/**
 * Join fields into the exact string the fingerprint is taken over.
 *
 * A missing value contributes `name=` and nothing more — that is how the first
 * record in a chain, which has no previous hash, is represented.
 */
export function buildHashInput(order: readonly string[], fields: HashFields): string {
  return order
    .map(name => `${name}=${(fields[name] ?? '').trim()}`)
    .join('&');
}

/** SHA-256 over the UTF-8 bytes, as 64 uppercase hex characters. */
export async function computeHash(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Cents to the decimal string the record carries, e.g. 12345 -> "123.45". */
export function formatAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** yyyy-mm-dd to the dd-mm-yyyy the record carries. */
export function formatInvoiceDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
}

/**
 * A Date as `2024-01-01T19:20:30+01:00`, in the given offset in minutes
 * (defaults to the machine's). The record has to carry a real offset, so this
 * never emits a bare `Z`.
 */
export function formatTimestamp(when: Date, offsetMinutes = -when.getTimezoneOffset()): string {
  const shifted = new Date(when.getTime() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
    + `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export interface AltaRecord {
  fields: Record<string, string>;
  /** The exact string hashed. Kept so the UI can show its work. */
  hashInput: string;
  hash: string;
  previousHash: string;
  /** "S" on the first record of a chain, per the spec's PrimerRegistro field. */
  primerRegistro: 'S' | 'N';
}

/**
 * Build the alta record for an invoice, chained to `previousHash`.
 *
 * `generatedAt` is passed in rather than read from the clock so the result is
 * reproducible — a fingerprint that changes between runs cannot be tested.
 */
export async function buildAltaRecord(
  invoice: Invoice,
  profile: Profile,
  previousHash: string,
  generatedAt: string,
): Promise<AltaRecord> {
  const fields: Record<string, string> = {
    IDEmisorFactura: profile.nif,
    NumSerieFactura: invoice.id,
    FechaExpedicionFactura: formatInvoiceDate(invoice.issuedOn),
    // F1 is a complete invoice. Simplified invoices (F2) are out of scope here.
    TipoFactura: 'F1',
    CuotaTotal: formatAmount(invoice.vatCents),
    ImporteTotal: formatAmount(invoice.totalCents),
    Huella: previousHash,
    FechaHoraHusoGenRegistro: generatedAt,
  };
  const hashInput = buildHashInput(ALTA_FIELDS, fields);
  return {
    fields,
    hashInput,
    hash: await computeHash(hashInput),
    previousHash,
    primerRegistro: previousHash ? 'N' : 'S',
  };
}

export interface ChainEntry {
  id: string;
  hash: string;
  previousHash: string;
  hashInput: string;
}

export interface ChainProblem {
  index: number;
  id: string;
  problem: 'hash-does-not-match-contents' | 'previous-hash-does-not-match-predecessor';
  expected: string;
  found: string;
}

/**
 * Recompute the whole chain and report every break.
 *
 * This is the property that makes the records worth anything: editing any record
 * changes its own fingerprint, which breaks every record after it.
 */
export async function verifyChain(entries: ChainEntry[]): Promise<ChainProblem[]> {
  const problems: ChainProblem[] = [];
  let expectedPrevious = '';

  for (const [index, entry] of entries.entries()) {
    const recomputed = await computeHash(entry.hashInput);
    if (recomputed !== entry.hash) {
      problems.push({
        index, id: entry.id,
        problem: 'hash-does-not-match-contents',
        expected: recomputed, found: entry.hash,
      });
    }
    if (entry.previousHash !== expectedPrevious) {
      problems.push({
        index, id: entry.id,
        problem: 'previous-hash-does-not-match-predecessor',
        expected: expectedPrevious, found: entry.previousHash,
      });
    }
    expectedPrevious = entry.hash;
  }

  return problems;
}

/**
 * QR code contents (RD 1007/2023 art. 21, and the AEAT detail document:
 * https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/DetalleEspecificacTecnCodigoQRfactura.pdf ).
 *
 * The QR holds a URL to the AEAT's invoice-checking service carrying four
 * parameters, in this order: nif, numserie, fecha, importe.
 *
 * We point at the external TEST endpoint on purpose. A QR aimed at the
 * production checker would tell whoever scans it that this invoice is
 * registered with the tax agency, and it is not — nothing here is ever
 * submitted.
 */
export const QR_TEST_ENDPOINT = 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR';

/**
 * Percent-encode the way `java.net.URLEncoder.encode(value, "UTF-8")` does,
 * which is what the specification's own example uses.
 *
 * This is form encoding, not `encodeURIComponent`: a space becomes `+`, and
 * `*`, `-`, `.` and `_` are left alone. For invoice serials the difference
 * rarely shows up, but "rarely" is not "never" and the fingerprint of a wrong
 * QR is silent.
 */
export function formUrlEncode(value: string): string {
  let out = '';
  for (const byte of new TextEncoder().encode(value)) {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9*\-._]/.test(char)) out += char;
    else if (char === ' ') out += '+';
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

export interface QrParams {
  nif: string;
  /** Invoice series and number, as issued. */
  numserie: string;
  /** Issue date as dd-mm-yyyy. */
  fecha: string;
  /** Total amount as a decimal string. */
  importe: string;
}

export function buildQrUrl(params: QrParams, endpoint = QR_TEST_ENDPOINT): string {
  const query = (['nif', 'numserie', 'fecha', 'importe'] as const)
    .map(key => `${key}=${formUrlEncode(params[key])}`)
    .join('&');
  return `${endpoint}?${query}`;
}
