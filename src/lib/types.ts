/** Shared domain types. Everything here is stored locally, in the user's browser. */

export type VatRegime = 'general' | 'exempt';
export type IncomeTaxMethod = 'direct' | 'modules';

export interface Profile {
  id: 'me';
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
