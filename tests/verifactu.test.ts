import { describe, it, expect } from 'vitest';
import {
  ALTA_FIELDS, ANULACION_FIELDS, buildHashInput, computeHash,
  formatAmount, formatInvoiceDate, formatTimestamp,
  buildAltaRecord, verifyChain, buildQrUrl, formUrlEncode, type ChainEntry,
} from '../src/lib/verifactu';
import type { Invoice, Profile } from '../src/lib/types';

/**
 * The three worked examples from section 6 of the AEAT specification, verbatim.
 * If these ever stop matching, the implementation is wrong — not the vectors.
 */
describe('AEAT official test vectors', () => {
  it('case 1: first record in a chain, with no previous hash', async () => {
    const input = buildHashInput(ALTA_FIELDS, {
      IDEmisorFactura: '89890001K',
      NumSerieFactura: '12345678/G33',
      FechaExpedicionFactura: '01-01-2024',
      TipoFactura: 'F1',
      CuotaTotal: '12.35',
      ImporteTotal: '123.45',
      Huella: '',
      FechaHoraHusoGenRegistro: '2024-01-01T19:20:30+01:00',
    });
    expect(input).toBe(
      'IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024'
      + '&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella='
      + '&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00');
    expect(await computeHash(input))
      .toBe('3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60');
  });

  it('case 2: a later record, chained to the one before it', async () => {
    const input = buildHashInput(ALTA_FIELDS, {
      IDEmisorFactura: '89890001K',
      NumSerieFactura: '12345679/G34',
      FechaExpedicionFactura: '01-01-2024',
      TipoFactura: 'F1',
      CuotaTotal: '12.35',
      ImporteTotal: '123.45',
      Huella: '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60',
      FechaHoraHusoGenRegistro: '2024-01-01T19:20:35+01:00',
    });
    expect(await computeHash(input))
      .toBe('F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97');
  });

  it('case 3: a cancellation record', async () => {
    const input = buildHashInput(ANULACION_FIELDS, {
      IDEmisorFacturaAnulada: '89890001K',
      NumSerieFacturaAnulada: '12345679/G34',
      FechaExpedicionFacturaAnulada: '01-01-2024',
      Huella: 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97',
      FechaHoraHusoGenRegistro: '2024-01-01T19:20:40+01:00',
    });
    expect(await computeHash(input))
      .toBe('177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68');
  });
});

describe('buildHashInput', () => {
  it('leaves a bare name= for a missing value', () => {
    expect(buildHashInput(['A', 'B'], { A: 'x' })).toBe('A=x&B=');
  });
  it('trims surrounding whitespace but keeps inner spaces', () => {
    expect(buildHashInput(['A'], { A: '  12345678 / G33  ' })).toBe('A=12345678 / G33');
  });
  it('never leaves a trailing separator', () => {
    expect(buildHashInput(['A', 'B'], { A: '1', B: '2' }).endsWith('&')).toBe(false);
  });
});

describe('computeHash', () => {
  it('returns 64 uppercase hex characters', async () => {
    expect(await computeHash('anything')).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe('formatAmount', () => {
  it('formats whole euros with two decimals', () => expect(formatAmount(12300)).toBe('123.00'));
  it('formats cents', () => expect(formatAmount(12345)).toBe('123.45'));
  it('pads a single-digit cent value', () => expect(formatAmount(12305)).toBe('123.05'));
  it('handles zero', () => expect(formatAmount(0)).toBe('0.00'));
  it('handles negatives', () => expect(formatAmount(-12345)).toBe('-123.45'));
});

describe('formatInvoiceDate', () => {
  it('turns yyyy-mm-dd into dd-mm-yyyy', () =>
    expect(formatInvoiceDate('2024-01-01')).toBe('01-01-2024'));
});

describe('formatTimestamp', () => {
  it('emits an offset rather than a bare Z', () => {
    expect(formatTimestamp(new Date('2024-01-01T18:20:30Z'), 60))
      .toBe('2024-01-01T19:20:30+01:00');
  });
  it('handles negative offsets', () => {
    expect(formatTimestamp(new Date('2024-01-01T18:20:30Z'), -300))
      .toBe('2024-01-01T13:20:30-05:00');
  });
  it('handles UTC itself', () => {
    expect(formatTimestamp(new Date('2024-01-01T18:20:30Z'), 0))
      .toBe('2024-01-01T18:20:30+00:00');
  });
});

const profile: Profile = {
  id: 'demo', name: 'Test', nif: '89890001K',
  startedTrading: '2020-01-01', vatRegime: 'general',
  incomeTaxMethod: 'direct', hasEmployees: false,
};

function invoice(id: string, baseCents: number, vatCents: number): Invoice {
  return {
    id, mode: 'demo', issuedOn: '2024-01-01',
    clientName: 'Client', clientNif: '89890002E',
    baseCents, vatRate: 21, vatCents, totalCents: baseCents + vatCents,
  };
}

describe('buildAltaRecord', () => {
  it('reproduces the official case 1 record end to end', async () => {
    const record = await buildAltaRecord(
      invoice('12345678/G33', 11110, 1235), profile, '', '2024-01-01T19:20:30+01:00');
    expect(record.fields.ImporteTotal).toBe('123.45');
    expect(record.fields.CuotaTotal).toBe('12.35');
    expect(record.hash).toBe('3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60');
  });

  it('marks the first record of a chain', async () => {
    const first = await buildAltaRecord(invoice('A/1', 1000, 210), profile, '', '2024-01-01T00:00:00+01:00');
    expect(first.primerRegistro).toBe('S');
    const second = await buildAltaRecord(invoice('A/2', 1000, 210), profile, first.hash, '2024-01-01T00:00:01+01:00');
    expect(second.primerRegistro).toBe('N');
  });

  it('gives different fingerprints to invoices differing only in amount', async () => {
    const a = await buildAltaRecord(invoice('A/1', 1000, 210), profile, '', '2024-01-01T00:00:00+01:00');
    const b = await buildAltaRecord(invoice('A/1', 1001, 210), profile, '', '2024-01-01T00:00:00+01:00');
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('verifyChain', () => {
  async function chainOfThree(): Promise<ChainEntry[]> {
    const entries: ChainEntry[] = [];
    let previous = '';
    for (const [i, id] of ['A/1', 'A/2', 'A/3'].entries()) {
      const record = await buildAltaRecord(
        invoice(id, 1000 + i, 210), profile, previous, `2024-01-01T00:00:0${i}+01:00`);
      entries.push({ id, hash: record.hash, previousHash: record.previousHash, hashInput: record.hashInput });
      previous = record.hash;
    }
    return entries;
  }

  it('accepts an untampered chain', async () => {
    expect(await verifyChain(await chainOfThree())).toEqual([]);
  });

  it('catches an edited record and the break it causes downstream', async () => {
    // The point of the whole mechanism: changing the middle record cannot be
    // hidden, because the record after it still carries the original fingerprint.
    const entries = await chainOfThree();
    const before = entries[1].hashInput;
    entries[1].hashInput = before.replace(/ImporteTotal=[\d.]+/, 'ImporteTotal=99999.99');
    expect(entries[1].hashInput).not.toBe(before); // the edit must actually land

    const problems = await verifyChain(entries);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some(p => p.index === 1 && p.problem === 'hash-does-not-match-contents')).toBe(true);
  });

  it('catches a record spliced out of the middle', async () => {
    const entries = await chainOfThree();
    const problems = await verifyChain([entries[0], entries[2]]);
    expect(problems.some(p => p.problem === 'previous-hash-does-not-match-predecessor')).toBe(true);
  });

  it('accepts an empty chain', async () => {
    expect(await verifyChain([])).toEqual([]);
  });
});

describe('QR contents', () => {
  it('reproduces the official worked example from the AEAT QR document', () => {
    expect(buildQrUrl({
      nif: '89890001K',
      numserie: '12345678&G33',
      fecha: '01-01-2024',
      importe: '241.4',
    })).toBe(
      'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR'
      + '?nif=89890001K&numserie=12345678%26G33&fecha=01-01-2024&importe=241.4');
  });

  it('keeps the four parameters in the order the spec gives them', () => {
    const url = buildQrUrl({ nif: 'A', numserie: 'B', fecha: 'C', importe: 'D' });
    expect(url.slice(url.indexOf('?'))).toBe('?nif=A&numserie=B&fecha=C&importe=D');
  });
});

describe('formUrlEncode', () => {
  it('encodes a space as + like java.net.URLEncoder, not as %20', () => {
    expect(formUrlEncode('a b')).toBe('a+b');
  });
  it('leaves the unreserved set alone', () => {
    expect(formUrlEncode('aZ0*-._')).toBe('aZ0*-._');
  });
  it('percent-encodes an ampersand so it cannot split the query', () => {
    expect(formUrlEncode('12345678&G33')).toBe('12345678%26G33');
  });
  it('encodes non-ASCII as UTF-8 bytes', () => {
    expect(formUrlEncode('ñ')).toBe('%C3%B1');
  });
});
