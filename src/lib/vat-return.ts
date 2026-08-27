/**
 * Modelo 303 — quarterly VAT self-assessment, general regime.
 *
 * Box numbers come from the AEAT's published record design for the model
 * (DR303e24v200), not from memory. The ones used here:
 *
 *   [01][02][03]  base, rate, quota — first rate row of output VAT
 *   [04][05][06]  second rate row
 *   [07][08][09]  third rate row
 *   [27]          total output VAT
 *   [28][29]      input VAT on current domestic purchases, base and quota
 *   [45]          total deductible
 *   [46]          general regime result ( [27] − [45] )
 *   [64]          sum of results
 *   [65][66]      share attributable to the State, and the amount
 *   [69][71]      result of the self-assessment, and final result
 *
 * Pure functions: no DOM, no storage, no clock. The arithmetic is the part that
 * has to be right, so it is the part that gets tested.
 */
import type { Invoice } from './types';

/** Rows the form provides for output VAT at different rates. */
const RATE_ROWS = [
  { base: '01', rate: '02', quota: '03' },
  { base: '04', rate: '05', quota: '06' },
  { base: '07', rate: '08', quota: '09' },
] as const;

export interface RateRow {
  baseCasilla: string;
  rateCasilla: string;
  quotaCasilla: string;
  vatRate: number;
  baseCents: number;
  quotaCents: number;
}

export interface VatReturn {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  /** Filing period as the form labels it. */
  period: '1T' | '2T' | '3T' | '4T';
  rows: RateRow[];
  /** [27] total output VAT. */
  totalOutputCents: number;
  /** [29] and [45]. Zero here, and the caller is told why. */
  totalDeductibleCents: number;
  /** [46] = [27] − [45], and the same figure flows to [64], [66], [69], [71]. */
  resultCents: number;
  /** Invoices left out of the rate rows, with the reason. */
  excluded: Array<{ id: string; reason: string }>;
  /** Things this return cannot know, stated rather than silently assumed. */
  caveats: string[];
}

export function quarterOf(isoDate: string): 1 | 2 | 3 | 4 {
  const month = Number(isoDate.slice(5, 7));
  return (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

/** Invoices issued inside the given quarter. */
export function invoicesForQuarter(invoices: Invoice[], year: number, quarter: 1 | 2 | 3 | 4): Invoice[] {
  return invoices.filter(i =>
    Number(i.issuedOn.slice(0, 4)) === year && quarterOf(i.issuedOn) === quarter);
}

/**
 * Build the return for one quarter.
 *
 * Zero-rated invoices are deliberately not placed in a rate row. An operation
 * charging no VAT is either exempt or outside the scope, those belong in
 * different boxes, and nothing in the amount says which — the same reason the
 * submission tool refuses to classify them.
 */
export function buildVatReturn(
  invoices: Invoice[],
  year: number,
  quarter: 1 | 2 | 3 | 4,
): VatReturn {
  const inPeriod = invoicesForQuarter(invoices, year, quarter);
  const excluded: Array<{ id: string; reason: string }> = [];

  const byRate = new Map<number, { baseCents: number; quotaCents: number }>();
  for (const invoice of inPeriod) {
    if (invoice.vatRate === 0) {
      excluded.push({
        id: invoice.id,
        reason: 'charges no VAT — exempt and outside-the-scope operations go in different boxes, '
          + 'and which one applies cannot be read off the amount',
      });
      continue;
    }
    const bucket = byRate.get(invoice.vatRate) ?? { baseCents: 0, quotaCents: 0 };
    bucket.baseCents += invoice.baseCents;
    bucket.quotaCents += invoice.vatCents;
    byRate.set(invoice.vatRate, bucket);
  }

  const rates = [...byRate.keys()].sort((a, b) => a - b);
  const rows: RateRow[] = [];
  for (const [index, vatRate] of rates.entries()) {
    const slot = RATE_ROWS[index];
    const bucket = byRate.get(vatRate)!;
    if (!slot) {
      excluded.push({
        id: `all invoices at ${vatRate}%`,
        reason: `the form provides ${RATE_ROWS.length} rate rows and this quarter used more`,
      });
      continue;
    }
    rows.push({
      baseCasilla: slot.base,
      rateCasilla: slot.rate,
      quotaCasilla: slot.quota,
      vatRate,
      baseCents: bucket.baseCents,
      quotaCents: bucket.quotaCents,
    });
  }

  const totalOutputCents = rows.reduce((sum, r) => sum + r.quotaCents, 0);
  // Nothing to deduct: this app records invoices issued, never invoices received.
  const totalDeductibleCents = 0;

  const caveats = [
    'Input VAT is zero because Ventanilla only records invoices you issue. A real return '
    + 'deducts VAT on what you bought, so box [29] and box [45] will be wrong until purchases '
    + 'are entered somewhere.',
    'Only the general regime is computed. Equivalence surcharge, intra-community acquisitions, '
    + 'reverse charge, fixed assets and prorrata are left untouched.',
    'No amounts pending from earlier periods are carried in, so box [78] stays empty.',
  ];

  return {
    year,
    quarter,
    period: `${quarter}T` as VatReturn['period'],
    rows,
    totalOutputCents,
    totalDeductibleCents,
    resultCents: totalOutputCents - totalDeductibleCents,
    excluded,
    caveats,
  };
}

/** The boxes to transcribe, in the order the form asks for them. */
export function casillas(vat: VatReturn): Array<{ number: string; label: string; value: string }> {
  const money = (cents: number) => (cents / 100).toFixed(2);
  const out: Array<{ number: string; label: string; value: string }> = [];

  for (const row of vat.rows) {
    out.push({ number: row.baseCasilla, label: `Base imponible al ${row.vatRate}%`, value: money(row.baseCents) });
    out.push({ number: row.rateCasilla, label: 'Tipo %', value: row.vatRate.toFixed(2) });
    out.push({ number: row.quotaCasilla, label: 'Cuota', value: money(row.quotaCents) });
  }

  out.push({ number: '27', label: 'Total cuota devengada', value: money(vat.totalOutputCents) });
  out.push({ number: '29', label: 'Cuotas soportadas, operaciones interiores corrientes', value: money(vat.totalDeductibleCents) });
  out.push({ number: '45', label: 'Total a deducir', value: money(vat.totalDeductibleCents) });
  out.push({ number: '46', label: 'Resultado régimen general ( [27] − [45] )', value: money(vat.resultCents) });
  out.push({ number: '64', label: 'Suma de resultados', value: money(vat.resultCents) });
  out.push({ number: '65', label: '% atribuible a la Administración del Estado', value: '100' });
  out.push({ number: '66', label: 'Atribuible a la Administración del Estado', value: money(vat.resultCents) });
  out.push({ number: '69', label: 'Resultado de la autoliquidación', value: money(vat.resultCents) });
  out.push({ number: '71', label: 'Resultado', value: money(vat.resultCents) });

  return out;
}
