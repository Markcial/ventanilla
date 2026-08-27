/**
 * Send one prepared Verifactu envelope to the AEAT preproduction service.
 *
 * This is a local command you run deliberately, with your own certificate. It is
 * not a way around the boundary the app keeps: the browser still cannot send —
 * no CORS, no client certificate from fetch() — and nothing here runs in a page.
 *
 * The endpoint is fixed. Preproduction has no fiscal effect, which is what makes
 * it safe to send invented invoices to. Production would put them in a real
 * declared invoicing chain, so this script has no way to reach it.
 *
 *   node scripts/submit-to-pre.mjs --cert cert.pem --key key.pem --file record.xml
 *
 * Add --passphrase if the key is encrypted.
 */
import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

const ENDPOINT = 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const cert = arg('cert');
const key = arg('key');
const file = arg('file');
const passphrase = arg('passphrase');

if (!cert || !key || !file) {
  console.error(`Usage: node scripts/submit-to-pre.mjs --cert cert.pem --key key.pem --file record.xml [--passphrase xxx]

Export a PEM pair from a .p12 first:
  openssl pkcs12 -in certificado.p12 -clcerts -nokeys -out cert.pem -legacy
  openssl pkcs12 -in certificado.p12 -nocerts -nodes -out key.pem -legacy`);
  process.exit(2);
}

for (const [label, path] of [['certificate', cert], ['key', key], ['envelope', file]]) {
  if (!existsSync(path)) {
    console.error(`No ${label} at ${path}`);
    process.exit(2);
  }
}

const envelope = readFileSync(file, 'utf8');
if (!envelope.includes('RegFactuSistemaFacturacion')) {
  console.error(`${file} does not look like a Verifactu submission — no RegFactuSistemaFacturacion element.`);
  process.exit(2);
}
// Refuse to send something that names production, whatever produced it.
if (/www1\.agenciatributaria\.gob\.es/.test(envelope)) {
  console.error('That envelope names the production service. Refusing to send it.');
  process.exit(2);
}

console.log(`Sending ${file}`);
console.log(`  to ${ENDPOINT}`);
console.log(`  as ${cert}\n`);

const args = [
  '-sS', '-i', '--max-time', '60',
  '--cert', passphrase ? `${cert}:${passphrase}` : cert,
  '--key', key,
  '-H', 'Content-Type: text/xml; charset=utf-8',
  '-H', 'SOAPAction: ""',
  '--data-binary', `@${file}`,
  ENDPOINT,
];

let raw;
try {
  const { stdout } = await run('curl', args, { maxBuffer: 8 * 1024 * 1024 });
  raw = stdout;
} catch (err) {
  console.error('curl failed:', err.stderr || err.message);
  process.exit(1);
}

const status = /^HTTP\/[\d.]+ (\d+)/m.exec(raw)?.[1] ?? '?';
const body = raw.slice(raw.indexOf('\r\n\r\n') + 4);

console.log(`HTTP ${status}\n`);

if (status === '302' || /erro4033/.test(raw)) {
  console.log('Bounced to an error page without reaching the service.');
  console.log('That is what an unaccepted client certificate looks like here. Either the');
  console.log('certificate was not sent, or it is not enrolled for this environment.');
  process.exit(1);
}

/** Pull one tag's text, whatever namespace prefix it carries. */
const field = name => {
  const m = new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`).exec(body);
  return m?.[1];
};
const all = name => [...body.matchAll(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`, 'g'))]
  .map(m => m[1]);

const fault = field('faultstring');
if (fault) {
  console.log(`SOAP fault: ${fault}`);
  process.exit(1);
}

const summary = {
  'Envío': field('EstadoEnvio'),
  'CSV': field('CSV'),
  'NIF presentador': field('NIF'),
  'Registro': field('EstadoRegistro'),
  'Código error': field('CodigoErrorRegistro'),
  'Descripción': field('DescripcionErrorRegistro'),
};
const shown = Object.entries(summary).filter(([, v]) => v);

if (shown.length) {
  for (const [k, v] of shown) console.log(`  ${k.padEnd(16)} ${v}`);
  const errors = all('DescripcionErrorRegistro').filter(Boolean);
  if (errors.length > 1) {
    console.log('\n  Other errors:');
    for (const e of errors.slice(1)) console.log(`    ${e}`);
  }
  console.log();
  const state = field('EstadoEnvio') ?? field('EstadoRegistro');
  if (state && /correcto/i.test(state) && !/incorrecto/i.test(state)) {
    console.log('Accepted. Keep the CSV — it is the receipt.');
    process.exit(0);
  }
  process.exit(1);
}

console.log('Could not read the response. Raw body follows:\n');
console.log(body.slice(0, 2000));
process.exit(1);
