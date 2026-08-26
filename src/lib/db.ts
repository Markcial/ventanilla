/**
 * Local store. Everything the user owns lives here and nowhere else.
 *
 * There is no backend by design: no server holds a NIF or a taxable base, which
 * is what lets an agent work on real fiscal data at all. It also means a cleared
 * browser profile is a wiped account — acceptable for a demo, and stated plainly
 * in the UI.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { Profile, Invoice } from './types';

const DB_NAME = 'ventanilla';
const VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  dbPromise ??= openDB(DB_NAME, VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('profile')) {
        database.createObjectStore('profile', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('invoices')) {
        const store = database.createObjectStore('invoices', { keyPath: 'id' });
        store.createIndex('issuedOn', 'issuedOn');
      }
    },
  });
  return dbPromise;
}

/** A profile so the app is useful on first load. Clearly marked as sample data. */
export const SAMPLE_PROFILE: Profile = {
  id: 'me',
  name: 'Sample freelancer',
  nif: '12345678Z',
  startedTrading: '2021-03-15',
  vatRegime: 'general',
  incomeTaxMethod: 'direct',
  hasEmployees: false,
};

export async function getProfile(): Promise<Profile> {
  const existing = await (await db()).get('profile', 'me');
  if (existing) return existing as Profile;
  await saveProfile(SAMPLE_PROFILE);
  return SAMPLE_PROFILE;
}

export async function saveProfile(profile: Profile): Promise<void> {
  await (await db()).put('profile', profile);
}

export async function listInvoices(): Promise<Invoice[]> {
  const all = await (await db()).getAllFromIndex('invoices', 'issuedOn');
  return all as Invoice[];
}

export async function addInvoice(invoice: Invoice): Promise<void> {
  await (await db()).put('invoices', invoice);
}

/** Today as yyyy-mm-dd, in the browser's timezone. */
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
