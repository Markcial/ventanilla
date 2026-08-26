/**
 * The SOAP envelope the AEAT expects for a Verifactu submission.
 *
 * Built against the published schemas, not from memory:
 *   SuministroLR.xsd          — RegFactuSistemaFacturacion, the request root
 *   SuministroInformacion.xsd — RegistroFacturacionAltaType and its field order
 *   SistemaFacturacion.wsdl   — operation, soapAction and endpoints
 * all under https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/
 *
 * We generate the envelope and hand it to the person. We do not send it, and a
 * browser could not even if we wanted to: the endpoint answers no CORS headers
 * at all — a preflight is redirected to a 403 page — and it requires mutual TLS
 * with a client certificate, which fetch() has no way to present.
 *
 * That is not a limitation we are working around. It is the reason this project
 * exists in the shape it does: the tax agency is reachable only by a person
 * holding a certificate, so the agent prepares and the person submits.
 */
import type { Invoice, Profile } from './types';
import { formatAmount } from './verifactu';

const NS_SOAP = 'http://schemas.xmlsoap.org/soap/envelope/';
const NS_LR = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd';
const NS_SF = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd';

/** From SistemaFacturacion.wsdl. Production is listed so nobody has to guess it. */
export const ENDPOINTS = {
  test: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  production: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
} as const;

export const SOAP_ACTION = '';
export const OPERATION = 'RegFactuSistemaFacturacion';

/** Enumerations, each taken from the schema rather than assumed. */
const ID_VERSION = '1.0';        // VersionType permits only this
const TIPO_HUELLA = '01';        // TipoHuellaType: 01 = SHA-256
const IMPUESTO_IVA = '01';       // ImpuestoType: 01 = IVA
const REGIMEN_GENERAL = '01';    // ClaveRegimen: 01 = régimen general

export const EXEMPTION_CODES = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'] as const;
export const NOT_SUBJECT_CODES = ['N1', 'N2'] as const;
export type ExemptionCode = typeof EXEMPTION_CODES[number];
export type NotSubjectCode = typeof NOT_SUBJECT_CODES[number];

/**
 * How the line is treated for VAT. DetalleType requires exactly one of
 * CalificacionOperacion or OperacionExenta, and there is no default: a zero-rated
 * line can be exempt (E1–E8) or outside the scope of VAT (N1, N2), and only the
 * person issuing it knows which. The schema does not even document what the E
 * codes stand for, so this is not a gap a tool can fill by inference.
 */
export type TaxTreatment =
  | { kind: 'subject' }
  | { kind: 'exempt'; code: ExemptionCode }
  | { kind: 'notSubject'; code: NotSubjectCode };

export function isExemptionCode(value: string): value is ExemptionCode {
  return (EXEMPTION_CODES as readonly string[]).includes(value);
}

export function isNotSubjectCode(value: string): value is NotSubjectCode {
  return (NOT_SUBJECT_CODES as readonly string[]).includes(value);
}

function xml(value: string): string {
  return value.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** yyyy-mm-dd to the dd-mm-yyyy the schema's `fecha` type uses. */
function fecha(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}-${m}-${y}`;
}

export interface SubmissionInput {
  invoice: Invoice;
  profile: Profile;
  /** The record immediately before this one, or null if this starts the chain. */
  previous: Pick<Invoice, 'id' | 'issuedOn' | 'hash'> | null;
  /** Must be the same instant that went into the fingerprint, or the hash will not verify. */
  generatedAt: string;
  softwareVersion: string;
  taxTreatment: TaxTreatment;
}

/**
 * The whole SOAP request for one invoice.
 *
 * Field order follows RegistroFacturacionAltaType exactly. The schema is a
 * sequence, so a reordered element is invalid even when every value is right.
 */
export function buildSubmissionEnvelope(input: SubmissionInput): string {
  const { invoice, profile, previous, generatedAt, softwareVersion, taxTreatment } = input;

  // DetalleType puts this choice before TipoImpositivo, and a sequence in the
  // wrong order is invalid even when every value is right.
  const treatment = taxTreatment.kind === 'exempt'
    ? `<sf:OperacionExenta>${taxTreatment.code}</sf:OperacionExenta>`
    : taxTreatment.kind === 'notSubject'
      ? `<sf:CalificacionOperacion>${taxTreatment.code}</sf:CalificacionOperacion>`
      : '<sf:CalificacionOperacion>S1</sf:CalificacionOperacion>';

  // An exempt or non-subject line carries no rate and no quota.
  const rated = taxTreatment.kind === 'subject';

  const chain = previous && previous.hash
    ? `<sf:RegistroAnterior>
            <sf:IDEmisorFactura>${xml(profile.nif)}</sf:IDEmisorFactura>
            <sf:NumSerieFactura>${xml(previous.id)}</sf:NumSerieFactura>
            <sf:FechaExpedicionFactura>${fecha(previous.issuedOn)}</sf:FechaExpedicionFactura>
            <sf:Huella>${xml(previous.hash)}</sf:Huella>
          </sf:RegistroAnterior>`
    : '<sf:PrimerRegistro>S</sf:PrimerRegistro>';

  // Self-developed software: the person issuing the invoices is also the producer
  // of the system, so the same NIF appears in both places. That is the ordinary
  // case for a tool someone builds for their own invoicing.
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${NS_SOAP}" xmlns:sfLR="${NS_LR}" xmlns:sf="${NS_SF}">
  <soapenv:Header/>
  <soapenv:Body>
    <sfLR:${OPERATION}>
      <sfLR:Cabecera>
        <sf:ObligadoEmision>
          <sf:NombreRazon>${xml(profile.name)}</sf:NombreRazon>
          <sf:NIF>${xml(profile.nif)}</sf:NIF>
        </sf:ObligadoEmision>
      </sfLR:Cabecera>
      <sfLR:RegistroFactura>
        <sf:RegistroAlta>
          <sf:IDVersion>${ID_VERSION}</sf:IDVersion>
          <sf:IDFactura>
            <sf:IDEmisorFactura>${xml(profile.nif)}</sf:IDEmisorFactura>
            <sf:NumSerieFactura>${xml(invoice.id)}</sf:NumSerieFactura>
            <sf:FechaExpedicionFactura>${fecha(invoice.issuedOn)}</sf:FechaExpedicionFactura>
          </sf:IDFactura>
          <sf:NombreRazonEmisor>${xml(profile.name)}</sf:NombreRazonEmisor>
          <sf:TipoFactura>F1</sf:TipoFactura>
          <sf:DescripcionOperacion>${xml(`Servicios facturados a ${invoice.clientName}`)}</sf:DescripcionOperacion>
          <sf:Destinatarios>
            <sf:IDDestinatario>
              <sf:NombreRazon>${xml(invoice.clientName)}</sf:NombreRazon>
              <sf:NIF>${xml(invoice.clientNif)}</sf:NIF>
            </sf:IDDestinatario>
          </sf:Destinatarios>
          <sf:Desglose>
            <sf:DetalleDesglose>
              <sf:Impuesto>${IMPUESTO_IVA}</sf:Impuesto>
              <sf:ClaveRegimen>${REGIMEN_GENERAL}</sf:ClaveRegimen>
              ${treatment}
              ${rated ? `<sf:TipoImpositivo>${invoice.vatRate.toFixed(2)}</sf:TipoImpositivo>` : ''}
              <sf:BaseImponibleOimporteNoSujeto>${formatAmount(invoice.baseCents)}</sf:BaseImponibleOimporteNoSujeto>
              ${rated ? `<sf:CuotaRepercutida>${formatAmount(invoice.vatCents)}</sf:CuotaRepercutida>` : ''}
            </sf:DetalleDesglose>
          </sf:Desglose>
          <sf:CuotaTotal>${formatAmount(invoice.vatCents)}</sf:CuotaTotal>
          <sf:ImporteTotal>${formatAmount(invoice.totalCents)}</sf:ImporteTotal>
          <sf:Encadenamiento>
            ${chain}
          </sf:Encadenamiento>
          <sf:SistemaInformatico>
            <sf:NombreRazon>${xml(profile.name)}</sf:NombreRazon>
            <sf:NIF>${xml(profile.nif)}</sf:NIF>
            <sf:NombreSistemaInformatico>Ventanilla</sf:NombreSistemaInformatico>
            <sf:IdSistemaInformatico>VT</sf:IdSistemaInformatico>
            <sf:Version>${xml(softwareVersion)}</sf:Version>
            <sf:NumeroInstalacion>VENTANILLA-BROWSER-1</sf:NumeroInstalacion>
            <sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu>
            <sf:TipoUsoPosibleMultiOT>N</sf:TipoUsoPosibleMultiOT>
            <sf:IndicadorMultiplesOT>N</sf:IndicadorMultiplesOT>
          </sf:SistemaInformatico>
          <sf:FechaHoraHusoGenRegistro>${xml(generatedAt)}</sf:FechaHoraHusoGenRegistro>
          <sf:TipoHuella>${TIPO_HUELLA}</sf:TipoHuella>
          <sf:Huella>${xml(invoice.hash ?? '')}</sf:Huella>
        </sf:RegistroAlta>
      </sfLR:RegistroFactura>
    </sfLR:${OPERATION}>
  </soapenv:Body>
</soapenv:Envelope>
`;
}

/** What a person needs alongside the envelope to actually send it themselves. */
export function submissionInstructions(endpoint: string, filename: string): string {
  return [
    '# How to send this yourself',
    '',
    'Ventanilla cannot send it for you. The endpoint answers no CORS headers, and it',
    'requires mutual TLS with your certificate, which a web page cannot present.',
    '',
    `Endpoint (AEAT external test environment):`,
    `  ${endpoint}`,
    '',
    'With your certificate exported as a PEM pair:',
    '',
    `  curl --cert cert.pem --key key.pem \\`,
    `    -H 'Content-Type: text/xml; charset=utf-8' \\`,
    `    -H 'SOAPAction: ""' \\`,
    `    --data-binary @${filename} \\`,
    `    ${endpoint}`,
    '',
    'The test environment accepts real certificates and has no fiscal consequences.',
    'Point at the production endpoint only when you mean it.',
  ].join('\n');
}
