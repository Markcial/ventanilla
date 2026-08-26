import { registerAll } from '../lib/webmcp';
import { ping } from './ping';
import { listObligations } from './list-obligations';

/** Every tool the page exposes to agents. One place, so the set is auditable. */
export const TOOLS = [ping, listObligations];

export async function registerTools(): Promise<string[]> {
  return registerAll(TOOLS);
}
