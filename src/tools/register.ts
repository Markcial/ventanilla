import { registerAll } from '../lib/webmcp';
import { ping } from './ping';

/** Every tool the page exposes to agents. One place, so the set is auditable. */
export const TOOLS = [ping];

export async function registerTools(): Promise<string[]> {
  return registerAll(TOOLS);
}
