import { defineConfig } from 'astro/config';

/**
 * GitHub Pages serves a project site under /<repo>/, so assets need that prefix or
 * the page loads and its script does not — which for this project means WebMCP
 * silently never registers and the page looks merely broken rather than broken in
 * a way anyone would diagnose.
 *
 * Set BASE_PATH in CI; local dev and the test harness stay at the root.
 */
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  output: 'static',
  base,
  site: process.env.SITE_URL,
  server: { port: 4321 },
  build: { assets: 'assets' },
});
