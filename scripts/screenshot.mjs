/** Capture the page as an agent-enabled browser sees it, after a tool has run. */
import { withWebMCP } from './webmcp-harness.mjs';
import { serve } from './serve.mjs';
import { writeFileSync } from 'node:fs';

const site = await serve('dist');
try {
  await withWebMCP(site.url, async client => {
    await client.invoke('list_obligations', { withinDays: 365 });
    const png = await client.screenshot();
    writeFileSync(process.argv[2] ?? 'screenshot.png', Buffer.from(png, 'base64'));
    console.log('saved', process.argv[2] ?? 'screenshot.png');
  });
} finally { await site.stop(); }
