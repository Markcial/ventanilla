import { describe, it, expect } from 'vitest';
import { quarterOf, invoicesForQuarter, buildVatReturn, casillas } from '../src/lib/vat-return';
import type { Invoice } from '../src/lib/types';

function invoice(id: string, issuedOn: string, baseEuros: number, vatRate: number): Invoice {
  const baseCents = Math.round(baseEuros * 100);
  const vatCents = Math.round(baseCents * vatRate / 100);
  return {
    id, mode: 'demo', issuedOn, clientName: 'Client', clientNif: '89890002E',
    baseCents, vatRate, vatCents, totalCents: baseCents + vatCents,
  };
}

describe('quarterOf', () => {
  it('maps months to quarters', () => {
    expect(quarterOf('2026-01-15')).toBe(1);
    expect(quarterOf('2026-03-31')).toBe(1);
    expect(quarterOf('2026-04-01')).toBe(2);
    expect(quarterOf('2026-09-30')).toBe(3);
    expect(quarterOf('2026-10-01')).toBe(4);
    expect(quarterOf('2026-12-31')).toBe(4);
  });
});

describe('invoicesForQuarter', () => {
  const all = [
    invoice('A/1', '2026-03-31', 100, 21),
    invoice('A/2', '2026-07-01', 100, 21),
    invoice('A/3', '2026-09-30', 100, 21),
    invoice('A/4', '2025-08-15', 100, 21),
  ];
  it('takes the boundaries of the quarter', () => {
    expect(invoicesForQuarter(all, 2026, 3).map(i => i.id)).toEqual(['A/2', 'A/3']);
  });
  it('does not cross years', () => {
    expect(invoicesForQuarter(all, 2026, 3).some(i => i.id === 'A/4')).toBe(false);
  });
});

describe('buildVatReturn', () => {
  const q3 = [
    invoice('A/1', '2026-07-03', 2400, 21),
    invoice('A/2', '2026-07-28', 1150.5, 21),
    invoice('A/3', '2026-08-11', 890, 10),
    invoice('A/4', '2026-08-22', 3200, 21),
    invoice('A/5', '2026-09-05', 1500, 0),
    invoice('A/6', '2026-09-19', 640, 21),
  ];

  it('groups by rate and assigns rows in ascending rate order', () => {
    const vat = buildVatReturn(q3, 2026, 3);
    expect(vat.rows.map(r => r.vatRate)).toEqual([10, 21]);
    expect(vat.rows[0].baseCasilla).toBe('01');
    expect(vat.rows[1].baseCasilla).toBe('04');
  });

  it('adds up bases and quotas per rate', () => {
    const vat = buildVatReturn(q3, 2026, 3);
    const at21 = vat.rows.find(r => r.vatRate === 21)!;
    // 2400 + 1150.50 + 3200 + 640
    expect(at21.baseCents).toBe(739050);
    // Each invoice carries its own rounded quota and the return sums those, rather
    // than applying the rate to the summed base. 1150.50 at 21% is 241.605, which
    // rounds to 241.61 on the invoice and stays 241.61 here.
    expect(at21.quotaCents).toBe(50400 + 24161 + 67200 + 13440);
    const at10 = vat.rows.find(r => r.vatRate === 10)!;
    expect(at10.baseCents).toBe(89000);
    expect(at10.quotaCents).toBe(8900);
  });

  it('leaves a zero-rated invoice out of the rate rows', () => {
    const vat = buildVatReturn(q3, 2026, 3);
    expect(vat.excluded.map(e => e.id)).toContain('A/5');
    expect(vat.rows.some(r => r.vatRate === 0)).toBe(false);
  });

  it('names the recorded reason when the invoice has one', () => {
    const withReason = [{ ...q3[4], vatTreatment: 'E1' }];
    const vat = buildVatReturn(withReason, 2026, 3);
    expect(vat.excluded[0].reason).toMatch(/E1/);
    expect(vat.excluded[0].reason).toMatch(/own boxes/i);
  });

  it('says a zero-rated invoice cannot be placed at all when it records no reason', () => {
    // register_invoice will not create this state, but a record from before that
    // was enforced can still turn up, and it must not be silently dropped.
    const vat = buildVatReturn(q3, 2026, 3);
    expect(vat.excluded[0].reason).toMatch(/does not record why/i);
  });

  it('totals output VAT into box 27', () => {
    const vat = buildVatReturn(q3, 2026, 3);
    expect(vat.totalOutputCents).toBe(50400 + 24161 + 67200 + 13440 + 8900);
  });

  it('reports zero deductible and says the return is incomplete because of it', () => {
    const vat = buildVatReturn(q3, 2026, 3);
    expect(vat.totalDeductibleCents).toBe(0);
    expect(vat.caveats.join(' ')).toMatch(/only records invoices you issue/i);
  });

  it('computes the result as output minus deductible', () => {
    const vat = buildVatReturn(q3, 2026, 3);
    expect(vat.resultCents).toBe(vat.totalOutputCents - vat.totalDeductibleCents);
  });

  it('sums quotas already rounded per invoice, not the rate applied to the total', () => {
    // Two invoices that each round up. Applying 21% to the combined base would give
    // 21.00; summing the per-invoice quotas gives 21.02. The invoices are what was
    // issued, so they are what the return has to agree with.
    const halves = [
      invoice('C/1', '2026-07-01', 50.05, 21),
      invoice('C/2', '2026-07-02', 49.95, 21),
    ];
    const vat = buildVatReturn(halves, 2026, 3);
    expect(vat.rows[0].baseCents).toBe(10000);
    expect(vat.rows[0].quotaCents).toBe(1051 + 1049);
  });

  it('is empty but valid for a quarter with no invoices', () => {
    const vat = buildVatReturn(q3, 2026, 1);
    expect(vat.rows).toEqual([]);
    expect(vat.totalOutputCents).toBe(0);
    expect(vat.resultCents).toBe(0);
  });

  it('flags rates beyond the rows the form provides', () => {
    const many = [
      invoice('B/1', '2026-07-01', 100, 4),
      invoice('B/2', '2026-07-02', 100, 10),
      invoice('B/3', '2026-07-03', 100, 21),
      invoice('B/4', '2026-07-04', 100, 5),
    ];
    const vat = buildVatReturn(many, 2026, 3);
    expect(vat.rows).toHaveLength(3);
    expect(vat.excluded.some(e => /rate rows/.test(e.reason))).toBe(true);
  });
});

describe('casillas', () => {
  const vat = buildVatReturn([
    invoice('A/1', '2026-07-03', 1000, 21),
  ], 2026, 3);

  it('renders amounts with two decimals', () => {
    const boxes = casillas(vat);
    expect(boxes.find(b => b.number === '01')!.value).toBe('1000.00');
    expect(boxes.find(b => b.number === '03')!.value).toBe('210.00');
  });

  it('states the rate in its own box', () => {
    expect(casillas(vat).find(b => b.number === '02')!.value).toBe('21.00');
  });

  it('carries the same result through 46, 64, 66, 69 and 71', () => {
    const boxes = casillas(vat);
    const result = boxes.find(b => b.number === '46')!.value;
    for (const n of ['64', '66', '69', '71']) {
      expect(boxes.find(b => b.number === n)!.value).toBe(result);
    }
  });

  it('attributes the whole result to the State', () => {
    expect(casillas(vat).find(b => b.number === '65')!.value).toBe('100');
  });
});
