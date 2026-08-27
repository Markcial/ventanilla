/** Shared domain types. Everything here is stored locally, in the user's browser. */
import type { Mode } from './mode';

export type VatRegime = 'general' | 'exempt';
export type IncomeTaxMethod = 'direct' | 'modules';

export interface Profile {
  /** Demo and real profiles are stored side by side and never merged. */
  id: Mode;
  name: string;
  /** Spanish tax ID. Never leaves this browser. */
  nif: string;
  /** Date the person registered as self-employed (fecha de alta), ISO yyyy-mm-dd. */
  startedTrading: string;
  vatRegime: VatRegime;
  incomeTaxMethod: IncomeTaxMethod;
  hasEmployees: boolean;
}

export interface Invoice {
  id: string;
  /** Which mode created this. Demo invoices must never leak into real totals. */
  mode: Mode;
  issuedOn: string;
  clientName: string;
  clientNif: string;
  /** Taxable base in euro cents, to keep money off floating point. */
  baseCents: number;
  vatRate: number;
  vatCents: number;
  totalCents: number;
  /** Verifactu chain fields, filled in by lib/verifactu.ts. */
  hash?: string;
  previousHash?: string;
  /**
   * Why no VAT was charged: E1-E8 for an exempt operation, N1 or N2 for one
   * outside the scope. Recorded when the invoice is created, because that is
   * when the person is thinking about this invoice — asking at submission time
   * means asking about something they filed away days ago.
   *
   * Absent on invoices that charge VAT, where the question does not arise.
   */
  vatTreatment?: string;
  /**
   * The exact instant that went into the fingerprint.
   *
   * Stored rather than recomputed: the submission envelope has to carry the same
   * value, and a fresh timestamp would produce a record whose Huella does not
   * match its own contents — which the AEAT marks as "aceptado con errores".
   */
  generatedAt?: string;
}

export interface Obligation {
  /** Official Spanish form name, kept verbatim — it is a proper noun. */
  form: string;
  title: string;
  periodLabel: string;
  /** First day the form can be filed. */
  windowOpens: string;
  /** Statutory last day, before any weekend adjustment. */
  statutoryDueDate: string;
  /** Actual last day, moved to the next working day if it fell on a weekend. */
  dueDate: string;
  /** Filing by direct debit closes earlier than filing by other means. */
  directDebitDueDate: string;
  /** Why this applies to this particular profile. */
  reason: string;
  daysRemaining: number;
}
