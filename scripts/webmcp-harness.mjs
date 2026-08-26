/**
 * Headless WebMCP test harness.
 *
 * Chrome 151 ships an undocumented CDP `WebMCP` domain. It lets us discover and
 * invoke the tools a page registers via `document.modelContext.registerTool`,
 * with no extension and no agent in the loop — so every tool can be asserted on
 * in an automated test.
 *
 *   WebMCP.enable()
 *   WebMCP.invokeTool({frameId, toolName, input}) -> {invocationId}
 *   event WebMCP.toolsAdded    {tools:[{name, description, inputSchema, annotations, frameId}]}
 *   event WebMCP.toolResponded {invocationId, status, output?, errorText?, exception?}
 *
 * Enabled with --enable-features=WebMCPTesting,DevToolsWebMCPSupport.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Chrome picks its own debugging port (`--remote-debugging-port=0`) and writes it
 * to DevToolsActivePort in the profile dir. Hardcoding a port meant a leftover
 * Chrome from an earlier run answered instead, and the harness drove the wrong
 * browser. Never hardcode it.
 */
async function readDebugPort(profile, timeoutMs = 20000) {
  const file = join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const port = parseInt(readFileSync(file, 'utf8').split('\n')[0], 10);
      if (port > 0) {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/json/version`);
          if (r.ok) return port;
        } catch { /* still starting */ }
      }
    }
    await sleep(150);
  }
  throw new Error('Chrome never reported a debugging port');
}

/**
 * Launch Chrome, open `url`, and hand a WebMCP client to `fn`.
 * Everything is torn down afterwards, even if `fn` throws.
 */
export async function withWebMCP(url, fn) {
  const profile = mkdtempSync(join(tmpdir(), 'webmcp-'));
  const chrome = spawn(CHROME, [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  let ws;
  try {
    const port = await readDebugPort(profile);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error('no page target');

    ws = new WebSocket(page.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    const tools = [];
    const responses = new Map();
    const waiters = new Map();

    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? reject(new Error(`${m.error.message} (${JSON.stringify(m.error.data ?? {})})`)) : resolve(m.result);
        return;
      }
      if (m.method === 'WebMCP.toolsAdded') tools.push(...m.params.tools);
      if (m.method === 'WebMCP.toolsRemoved') {
        for (const rm of m.params.tools) {
          const i = tools.findIndex(t => t.name === rm.name);
          if (i >= 0) tools.splice(i, 1);
        }
      }
      if (m.method === 'WebMCP.toolResponded') {
        responses.set(m.params.invocationId, m.params);
        waiters.get(m.params.invocationId)?.(m.params);
      }
    };

    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    await send('Page.enable');
    await send('Runtime.enable');
    // Enable BEFORE navigating so no toolsAdded event is missed.
    await send('WebMCP.enable');

    await send('Page.navigate', { url });
    await sleep(1500);

    const client = {
      /** Tools the page has registered, as the agent would see them. */
      listTools: () => tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
      })),

      /** Call a tool by name and wait for its real result. */
      async invoke(name, input = {}, { timeoutMs = 10000 } = {}) {
        const tool = tools.find(t => t.name === name);
        if (!tool) throw new Error(`tool "${name}" not registered — have: ${tools.map(t => t.name).join(', ') || '(none)'}`);
        const { invocationId } = await send('WebMCP.invokeTool', {
          frameId: tool.frameId, toolName: name, input,
        });
        const done = responses.get(invocationId) ?? await Promise.race([
          new Promise(r => waiters.set(invocationId, r)),
          sleep(timeoutMs).then(() => { throw new Error(`tool "${name}" timed out after ${timeoutMs}ms`); }),
        ]);
        if (done.status !== 'Completed') {
          throw new Error(`tool "${name}" -> ${done.status}: ${done.errorText ?? 'no detail'}`);
        }
        return done.output;
      },

      /** Read the first text block out of an MCP tool result. */
      text(output) {
        return output?.content?.find(c => c.type === 'text')?.text ?? JSON.stringify(output);
      },

      /** Run JS in the page — for asserting the UI actually changed. */
      async evaluate(expression) {
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
        return r.result.value;
      },
    };

    return await fn(client);
  } finally {
    try { ws?.close(); } catch { /* already gone */ }
    chrome.kill('SIGTERM');
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
