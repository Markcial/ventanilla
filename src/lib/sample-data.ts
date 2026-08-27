/**
 * Demo mode fixtures.
 *
 * Chosen so the demo has something to compute: invoices spread across Q3 2026 at
 * mixed VAT rates, one of them zero-rated, so a VAT return has real arithmetic to
 * do rather than adding one number to another.
 *
 * Every tax ID here is from the 8989000x range the AEAT's published examples use
 * (89890001K appears in the official QR document). Check digits are computed with
 * the real algorithm, so the values are well formed, and none of them identifies a
 * real person or company.
 *
 * They are therefore not accepted by the tax agency either. Submitting a record
 * with one comes back as error 1239, "El NIF no está identificado en el censo de
 * la AEAT" — even in preproduction, which validates recipients against the real
 * census. Being safe to demonstrate with and being acceptable to file are, it
 * turns out, the same property with opposite signs. Demo mode never submits, so
 * this costs nothing; a real submission needs a recipient who actually exists.
 *
 * That matters beyond tidiness. An earlier version of this file billed an
 * invented amount to "Ayuntamiento de Cadaqués" under a P-prefixed tax ID, which
 * is the real format for a Spanish municipality. Sample data must not put a real
 * body's tax identity on an invoice that documents nothing.
 *
 * Company names are invented. If one happens to resemble a real business, the tax
 * ID does not, and no invoice here describes anything that occurred.
 */
import type { Profile, Invoice } from './types';

export const DEMO_PROFILE: Profile = {
  id: 'demo',
  name: 'Sample freelancer',
  nif: '89890001K',
  startedTrading: '2021-03-15',
  vatRegime: 'general',
  incomeTaxMethod: 'direct',
  hasEmployees: false,
};

/** An empty shell until the person fills it in. */
export const EMPTY_REAL_PROFILE: Profile = {
  id: 'real',
  name: '',
  nif: '',
  startedTrading: '',
  vatRegime: 'general',
  incomeTaxMethod: 'direct',
  hasEmployees: false,
};

function euros(amount: number): number {
  return Math.round(amount * 100);
}

function invoice(
  n: number, issuedOn: string, clientName: string, clientNif: string,
  base: number, vatRate: number, vatTreatment?: string,
): Invoice {
  const baseCents = euros(base);
  const vatCents = Math.round(baseCents * vatRate / 100);
  return {
    id: `DEMO-2026-${String(n).padStart(3, '0')}`,
    mode: 'demo',
    issuedOn,
    clientName,
    clientNif,
    baseCents,
    vatRate,
    vatCents,
    totalCents: baseCents + vatCents,
    ...(vatTreatment ? { vatTreatment } : {}),
  };
}

export const DEMO_INVOICES: Invoice[] = [
  invoice(1, '2026-07-03', 'Astillero Ribera SL',    '89890002E', 2400,   21),
  invoice(2, '2026-07-28', 'Cooperativa La Vega',    '89890003T', 1150.5, 21),
  invoice(3, '2026-08-11', 'Editorial Marisma SL',   '89890004R',  890,   10),
  invoice(4, '2026-08-22', 'Naviera Tramuntana SL',  '89890005W', 3200,   21),
  // Exempt, with the reason recorded — a zero-rated invoice without one is not a
  // state this app lets you create.
  invoice(5, '2026-09-05', 'Consultorio Sant Jordi', '89890006A', 1500,    0, 'E1'),
  invoice(6, '2026-09-19', 'Taller Bonmatí SL',      '89890007G',  640,   21),
];
