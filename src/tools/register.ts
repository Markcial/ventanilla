import { registerAll } from '../lib/webmcp';
import { ping } from './ping';
import { listObligations } from './list-obligations';
import { registerInvoiceTool } from './register-invoice';
import { exportSubmission } from './export-submission';

/** Every tool the page exposes to agents. One place, so the set is auditable. */
export const TOOLS = [ping, listObligations, registerInvoiceTool, exportSubmission];

export async function registerTools(): Promise<string[]> {
  return registerAll(TOOLS);
}
