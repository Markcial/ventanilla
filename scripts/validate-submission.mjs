/**
 * Validate a generated submission against the AEAT's own published schemas.
 *
 * The schemas are fetched from the tax agency and cached in .schemas/ rather than
 * vendored, so the check runs against whatever they publish today instead of a
 * copy that quietly goes stale.
 *
 * This caught a real defect the first time it ran: DetalleType requires
 * CalificacionOperacion or OperacionExenta before TipoImpositivo, and every value
 * in the envelope was correct while the element order was not.
 *
 * Requires xmllint (bundled with macOS; libxml2-utils on Debian).
 */
import { withWebMCP } from './webmcp-harness.mjs';
import { serve } from './serve.mjs';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const BASE = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws';
const DIR = '.schemas';
const NS_LR = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd';
const NS_SF = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd';

async function fetchSchemas() {
  mkdirSync(DIR, { recursive: true });
  for (const name of ['SuministroLR.xsd', 'SuministroInformacion.xsd']) {
    const path = join(DIR, name);
    if (existsSync(path)) continue;
    const res = await fetch(`${BASE}/${name}`);
    if (!res.ok) throw new Error(`could not fetch ${name}: ${res.status}`);
    let body = await res.text();
    // Point the xmldsig import at a local copy so validation works offline.
    body = body.replace(
      'schemaLocation="http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd"',
      'schemaLocation="xmldsig-core-schema.xsd"');
    writeFileSync(path, body);
  }
  const sig = join(DIR, 'xmldsig-core-schema.xsd');
  if (!existsSync(sig)) {
    const res = await fetch('https://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd');
    writeFileSync(sig, await res.text());
  }
}

/** Lift the payload out of the SOAP body; the schema describes the payload only. */
function extractPayload(envelope) {
  const match = /<sfLR:RegFactuSistemaFacturacion>[\s\S]*?<\/sfLR:RegFactuSistemaFacturacion>/.exec(envelope);
  if (!match) throw new Error('no RegFactuSistemaFacturacion element in the envelope');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + match[0].replace(
    '<sfLR:RegFactuSistemaFacturacion>',
    `<sfLR:RegFactuSistemaFacturacion xmlns:sfLR="${NS_LR}" xmlns:sf="${NS_SF}">`);
}

async function validate(label, envelope) {
  const file = join(DIR, 'payload.xml');
  writeFileSync(file, extractPayload(envelope));
  try {
    await run('xmllint', ['--noout', '--schema', join(DIR, 'SuministroLR.xsd'), file]);
    console.log(`  ok   ${label}`);
    return true;
  } catch (err) {
    console.log(`  FAIL ${label}`);
    for (const line of String(err.stderr ?? err.message).trim().split('\n').slice(0, 4)) {
      console.log(`       ${line}`);
    }
    return false;
  }
}

await fetchSchemas();
console.log('Submission schema validation (AEAT SuministroLR.xsd)\n');

const site = await serve('dist');
const results = [];
try {
  await withWebMCP(site.url, async client => {
    const envelopeFor = async (args, label) => {
      const body = client.text(await client.invoke('export_submission', args));
      if (!/on screen/.test(body)) { console.log(`  FAIL ${label}\n       ${body.slice(0, 200)}`); return null; }
      return client.evaluate(`document.querySelector('#submission .envelope code').textContent`);
    };

    // A VAT-rated invoice: the ordinary case.
    const rated = await envelopeFor({ invoiceId: 'DEMO-2026-001' }, 'VAT-rated invoice');
    results.push(rated ? await validate('VAT-rated invoice', rated) : false);

    // A zero-rated invoice, with the exemption stated explicitly.
    const exempt = await envelopeFor({ invoiceId: 'DEMO-2026-005', vatTreatment: 'E1' }, 'exempt invoice');
    results.push(exempt ? await validate('exempt invoice (E1)', exempt) : false);

    // Same invoice treated as outside the scope of VAT.
    const notSubject = await envelopeFor({ invoiceId: 'DEMO-2026-005', vatTreatment: 'N1' }, 'non-subject invoice');
    results.push(notSubject ? await validate('non-subject invoice (N1)', notSubject) : false);

    // The first record in the chain uses PrimerRegistro instead of RegistroAnterior.
    if (rated) {
      results.push(/<sf:PrimerRegistro>S<\/sf:PrimerRegistro>/.test(rated)
        ? (console.log('  ok   first record uses PrimerRegistro'), true)
        : (console.log('  FAIL first record should use PrimerRegistro, not RegistroAnterior'), false));
    }
    // A later record must carry the predecessor's fingerprint.
    const chained = await envelopeFor({ invoiceId: 'DEMO-2026-002' }, 'chained invoice');
    results.push(chained ? await validate('chained invoice', chained) : false);
    if (chained) {
      results.push(/<sf:RegistroAnterior>/.test(chained)
        ? (console.log('  ok   later record uses RegistroAnterior'), true)
        : (console.log('  FAIL later record should carry RegistroAnterior'), false));
    }
  });
} finally {
  await site.stop();
}

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
