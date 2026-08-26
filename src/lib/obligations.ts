/**
 * Spanish self-employed filing calendar.
 *
 * Pure functions — no DOM, no storage, no network — so the date arithmetic can be
 * tested directly. Which obligations apply depends on the profile: VAT regime,
 * income tax method, and whether the person has employees.
 *
 * Known simplification, surfaced in the UI and README: deadlines falling on a
 * Saturday or Sunday are moved to the next working day, but national and regional
 * public holidays are NOT applied. Real filing software needs the full holiday
 * calendar; a demo should say so rather than pretend.
 */
import type { Profile, Obligation } from './types';

const DAY_MS = 86_400_000;

/** Quarterly forms open on the 1st and close on the 20th; Q4 closes on the 30th of January. */
const QUARTERS = [
  { quarter: 1, label: 'Q1', filingMonth: 4,  lastDay: 20, year: 0 },
  { quarter: 2, label: 'Q2', filingMonth: 7,  lastDay: 20, year: 0 },
  { quarter: 3, label: 'Q3', filingMonth: 10, lastDay: 20, year: 0 },
  { quarter: 4, label: 'Q4', filingMonth: 1,  lastDay: 30, year: 1 },
] as const;

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Move Saturday and Sunday forward to Monday. Public holidays are not handled. */
export function nextWorkingDay(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const day = d.getUTCDay();
  if (day === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (day === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS,
  );
}

interface FormSpec {
  form: string;
  title: string;
  reason: string;
}

/** Which quarterly forms this profile has to file. */
export function applicableQuarterlyForms(profile: Profile): FormSpec[] {
  const forms: FormSpec[] = [];

  if (profile.vatRegime === 'general') {
    forms.push({
      form: 'modelo 303',
      title: 'Quarterly VAT return',
      reason: 'You are registered under the general VAT regime, so VAT is self-assessed every quarter.',
    });
  }

  if (profile.incomeTaxMethod === 'direct') {
    forms.push({
      form: 'modelo 130',
      title: 'Quarterly income tax payment on account',
      reason: 'You report income tax under direct assessment (estimación directa), which requires quarterly payments on account.',
    });
  } else {
    forms.push({
      form: 'modelo 131',
      title: 'Quarterly income tax payment on account (modules)',
      reason: 'You report income tax under the modules regime (estimación objetiva).',
    });
  }

  if (profile.hasEmployees) {
    forms.push({
      form: 'modelo 111',
      title: 'Quarterly withholding return',
      reason: 'You have employees, so income tax withheld from their pay is reported quarterly.',
    });
  }

  return forms;
}

function buildObligation(spec: FormSpec, q: typeof QUARTERS[number], periodYear: number, today: string): Obligation {
  const filingYear = periodYear + q.year;
  const statutory = iso(filingYear, q.filingMonth, q.lastDay);
  const dueDate = nextWorkingDay(statutory);
  // Filing by direct debit closes five calendar days before the statutory deadline.
  const dd = new Date(`${statutory}T00:00:00Z`);
  dd.setUTCDate(dd.getUTCDate() - 5);
  return {
    form: spec.form,
    title: spec.title,
    periodLabel: `${q.label} ${periodYear}`,
    windowOpens: iso(filingYear, q.filingMonth, 1),
    statutoryDueDate: statutory,
    dueDate,
    directDebitDueDate: nextWorkingDay(dd.toISOString().slice(0, 10)),
    reason: spec.reason,
    daysRemaining: daysBetween(today, dueDate),
  };
}

/**
 * Obligations still open on `today`, soonest first.
 *
 * Nothing is returned for periods that ended before the person started trading.
 */
export function upcomingObligations(
  profile: Profile,
  today: string,
  horizonDays = 365,
): Obligation[] {
  const specs = applicableQuarterlyForms(profile);
  const thisYear = Number(today.slice(0, 4));
  const out: Obligation[] = [];

  for (const periodYear of [thisYear - 1, thisYear, thisYear + 1]) {
    for (const q of QUARTERS) {
      // A quarter only counts once the person was actually trading in it.
      const quarterEnds = iso(periodYear, q.quarter * 3, 28);
      if (quarterEnds < profile.startedTrading) continue;

      for (const spec of specs) {
        const ob = buildObligation(spec, q, periodYear, today);
        if (ob.daysRemaining < 0 || ob.daysRemaining > horizonDays) continue;
        out.push(ob);
      }
    }
  }

  return out.sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate) || a.form.localeCompare(b.form));
}
