/**
 * Thin typed wrapper over the WebMCP browser API.
 *
 * The API lives on `document.modelContext` as of Chrome 150; `navigator.modelContext`
 * still exists but is deprecated. TypeScript has no lib types for it yet, so the
 * shape is declared here and nowhere else.
 */

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
};

export interface ToolAnnotations {
  /** Tool only reads state. Agents may call read-only tools more freely. */
  readOnlyHint?: boolean;
  /** Output contains data we did not author (user input, third-party API). */
  untrustedContentHint?: boolean;
}

export interface ToolDefinition<Input = Record<string, unknown>> {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  execute: (input: Input) => Promise<ToolResult>;
}

interface ModelContext {
  registerTool(tool: ToolDefinition<any>, options?: { signal?: AbortSignal }): Promise<void>;
  unregisterTool?(name: string): Promise<void>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

/** True when this browser exposes WebMCP (Chrome 149+ with the trial enabled). */
export function isSupported(): boolean {
  return typeof document !== 'undefined' && 'modelContext' in document && !!document.modelContext;
}

/** Wrap plain text as an MCP tool result. */
export function text(body: string): ToolResult {
  return { content: [{ type: 'text', text: body }] };
}

/**
 * Register tools, skipping gracefully when WebMCP is unavailable so the page
 * still works as an ordinary web app.
 */
export async function registerAll(tools: ToolDefinition<any>[]): Promise<string[]> {
  if (!isSupported()) return [];
  const registered: string[] = [];
  for (const tool of tools) {
    try {
      await document.modelContext!.registerTool(tool);
      registered.push(tool.name);
    } catch (err) {
      console.error(`[webmcp] failed to register "${tool.name}":`, err);
    }
  }
  return registered;
}
