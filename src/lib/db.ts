/**
 * Local store. Everything the user owns lives here and nowhere else.
 *
 * There is no backend by design: no server holds a NIF or a taxable base, which
 * is what lets an agent work on real fiscal data at all. It also means a cleared
 * browser profile is a wiped account — acceptable here, and said plainly in the UI.
 *
 * Demo and real data are kept apart at the storage layer rather than by filtering
 * at the call site, so a missed filter cannot mix sample invoices into real totals.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { Profile, Invoice } from './types';
import { type Mode, isMode } from './mode';
import { DEMO_PROFILE, DEMO_INVOICES, EMPTY_REAL_PROFILE } from './sample-data';

const DB_NAME = 'ventanilla';
const VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  dbPromise ??= openDB(DB_NAME, VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('profiles', { keyPath: 'id' });
        const invoices = database.createObjectStore('invoices', { keyPath: 'id' });
        invoices.createIndex('mode', 'mode');
        database.createObjectStore('settings');
      }
      if (oldVersion === 1) {
        // v1 stored a single unscoped profile. There is no meaningful way to know
        // whether it was demo or real data, and guessing wrong would mix them, so
        // v1 stores are dropped and recreated.
        for (const name of ['profile', 'invoices']) {
          if (database.objectStoreNames.contains(name)) database.deleteObjectStore(name);
        }
        database.createObjectStore('profiles', { keyPath: 'id' });
        const invoices = database.createObjectStore('invoices', { keyPath: 'id' });
        invoices.createIndex('mode', 'mode');
        if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings');
      }
    },
  });
  return dbPromise;
}

/** Demo is the default: a first-time visitor must land on something that works. */
export async function getMode(): Promise<Mode> {
  const stored = await (await db()).get('settings', 'mode');
  return isMode(stored) ? stored : 'demo';
}

/**
 * Human action only. Never call this from a tool — see the note in mode.ts about
 * why an agent must not be able to move someone into real mode.
 */
export async function setMode(mode: Mode): Promise<void> {
  await (await db()).put('settings', mode, 'mode');
}

/** Seed demo fixtures once, so demo mode is useful the moment it loads. */
export async function ensureSeeded(): Promise<void> {
  const database = await db();
  if (!await database.get('profiles', 'demo')) {
    await database.put('profiles', DEMO_PROFILE);
    for (const inv of DEMO_INVOICES) await database.put('invoices', inv);
  }
  if (!await database.get('profiles', 'real')) {
    await database.put('profiles', EMPTY_REAL_PROFILE);
  }
}

export async function getProfile(mode: Mode): Promise<Profile> {
  await ensureSeeded();
  const found = await (await db()).get('profiles', mode);
  return (found ?? (mode === 'demo' ? DEMO_PROFILE : EMPTY_REAL_PROFILE)) as Profile;
}

export async function saveProfile(profile: Profile): Promise<void> {
  await (await db()).put('profiles', profile);
}

/** Only ever returns invoices belonging to the mode asked for. */
export async function listInvoices(mode: Mode): Promise<Invoice[]> {
  await ensureSeeded();
  const found = await (await db()).getAllFromIndex('invoices', 'mode', mode);
  return (found as Invoice[]).sort((a, b) => a.issuedOn.localeCompare(b.issuedOn));
}

export async function addInvoice(invoice: Invoice): Promise<void> {
  await (await db()).put('invoices', invoice);
}

/** A real profile is only usable once the person has actually filled it in. */
export function isProfileComplete(profile: Profile): boolean {
  return Boolean(profile.name && profile.nif && profile.startedTrading);
}

/** Today as yyyy-mm-dd, in the browser's timezone. */
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
