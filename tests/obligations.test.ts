import { describe, it, expect } from 'vitest';
import {
  nextWorkingDay, daysBetween, applicableQuarterlyForms, upcomingObligations,
} from '../src/lib/obligations';
import type { Profile } from '../src/lib/types';

const base: Profile = {
  id: 'me', name: 'Test', nif: '00000000T',
  startedTrading: '2020-01-01',
  vatRegime: 'general', incomeTaxMethod: 'direct', hasEmployees: false,
};

describe('nextWorkingDay', () => {
  it('leaves weekdays alone', () => {
    expect(nextWorkingDay('2026-10-20')).toBe('2026-10-20'); // Tuesday
  });
  it('moves Saturday to Monday', () => {
    expect(nextWorkingDay('2026-10-24')).toBe('2026-10-26');
  });
  it('moves Sunday to Monday', () => {
    expect(nextWorkingDay('2026-10-25')).toBe('2026-10-26');
  });
});

describe('daysBetween', () => {
  it('counts forward', () => expect(daysBetween('2026-08-26', '2026-10-20')).toBe(55));
  it('counts backward', () => expect(daysBetween('2026-10-20', '2026-08-26')).toBe(-55));
});

describe('applicableQuarterlyForms', () => {
  it('gives VAT and direct-assessment income tax by default', () => {
    expect(applicableQuarterlyForms(base).map(f => f.form))
      .toEqual(['modelo 303', 'modelo 130']);
  });
  it('drops VAT when the profile is VAT exempt', () => {
    const forms = applicableQuarterlyForms({ ...base, vatRegime: 'exempt' });
    expect(forms.map(f => f.form)).not.toContain('modelo 303');
  });
  it('uses modelo 131 under the modules regime', () => {
    const forms = applicableQuarterlyForms({ ...base, incomeTaxMethod: 'modules' });
    expect(forms.map(f => f.form)).toContain('modelo 131');
    expect(forms.map(f => f.form)).not.toContain('modelo 130');
  });
  it('adds withholding return when there are employees', () => {
    const forms = applicableQuarterlyForms({ ...base, hasEmployees: true });
    expect(forms.map(f => f.form)).toContain('modelo 111');
  });
});

describe('upcomingObligations', () => {
  it('makes Q3 the next thing due when asked in late August', () => {
    const next = upcomingObligations(base, '2026-08-26');
    // modelo 303 and modelo 130 share the 20 October deadline, so the tie is
    // broken by form name and "modelo 130" sorts first. Both are equally next.
    expect(next[0].dueDate).toBe('2026-10-20');
    expect(next.slice(0, 2).map(o => o.form).sort())
      .toEqual(['modelo 130', 'modelo 303']);
    expect(next.slice(0, 2).every(o => o.periodLabel === 'Q3 2026')).toBe(true);
    expect(next[0].daysRemaining).toBe(55);
  });

  it('never returns a deadline that has already passed', () => {
    for (const ob of upcomingObligations(base, '2026-08-26')) {
      expect(ob.daysRemaining).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns results ordered by due date', () => {
    const dates = upcomingObligations(base, '2026-08-26').map(o => o.dueDate);
    expect([...dates].sort()).toEqual(dates);
  });

  it('sets the direct debit deadline five days before the statutory one', () => {
    const q3 = upcomingObligations(base, '2026-08-26')
      .find(o => o.form === 'modelo 303' && o.periodLabel === 'Q3 2026')!;
    expect(q3.statutoryDueDate).toBe('2026-10-20');
    expect(q3.directDebitDueDate).toBe('2026-10-15');
  });

  it('ignores quarters before the person started trading', () => {
    const late = upcomingObligations({ ...base, startedTrading: '2027-01-01' }, '2026-08-26');
    expect(late.every(o => o.periodLabel.endsWith('2027'))).toBe(true);
  });

  it('respects the horizon', () => {
    expect(upcomingObligations(base, '2026-08-26', 30)).toHaveLength(0);
    expect(upcomingObligations(base, '2026-08-26', 60).length).toBeGreaterThan(0);
  });
});
