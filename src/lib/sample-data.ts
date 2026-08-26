/**
 * Demo mode fixtures.
 *
 * Chosen so the demo has something to compute: invoices spread across Q3 2026 at
 * mixed VAT rates, one of them zero-rated, so a VAT return has real arithmetic to
 * do rather than adding one number to another.
 */
import type { Profile, Invoice } from './types';

export const DEMO_PROFILE: Profile = {
  id: 'demo',
  name: 'Sample freelancer',
  nif: '12345678Z',
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
  base: number, vatRate: number,
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
  };
}

export const DEMO_INVOICES: Invoice[] = [
  invoice(1, '2026-07-03', 'Astillero Ribera SL',     'B12345674', 2400,   21),
  invoice(2, '2026-07-28', 'Cooperativa La Vega',     'F87654321', 1150.5, 21),
  invoice(3, '2026-08-11', 'Editorial Marisma SL',    'B11223344',  890,   10),
  invoice(4, '2026-08-22', 'Ayuntamiento de Cadaqués','P1703300B', 3200,   21),
  invoice(5, '2026-09-05', 'Clinica Sant Jordi SLP',  'B55667788', 1500,    0),
  invoice(6, '2026-09-19', 'Taller Bonmatí',          'B99887766',  640,   21),
];
