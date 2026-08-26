import { text, type ToolDefinition } from '../lib/webmcp';

/**
 * Smallest possible tool. Exists so the headless harness can prove the whole
 * chain — registration, discovery, invocation, response — on every run.
 */
export const ping: ToolDefinition = {
  name: 'ping',
  title: 'Ping',
  description: 'Health check. Returns "pong" and the browser clock. Use to verify the connection works.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
  execute: async () => text(`pong ${new Date().toISOString()}`),
};
