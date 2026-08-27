import { text, type ToolDefinition } from '../lib/webmcp';
import { getMode, getProfile, isProfileComplete, listInvoices } from '../lib/db';
import { modeNotice } from '../lib/mode';
import {
  buildSubmissionEnvelope, submissionInstructions, TEST_ENDPOINT,
  isExemptionCode, isNotSubjectCode, EXEMPTION_CODES, type TaxTreatment,
} from '../lib/soap';
import { renderSubmission } from '../lib/render';

interface Input { invoiceId?: string; vatTreatment?: string }

const SOFTWARE_VERSION = '0.1.0';

/**
 * Prepare the AEAT submission and hand it over.
 *
 * The end of what an agent can do alone.
 *
 * The envelope is prepared here and the page offers a Send button, which is an
 * ordinary form post: a navigation, so CORS does not apply, and the browser asks
 * which certificate to use. That prompt cannot be answered by script. The agent
 * does everything up to it and stops, which is the arrangement this whole project
 * argues for — now enforced by the browser rather than by our good intentions.
 */
export const exportSubmission: ToolDefinition<Input> = {
  name: 'export_submission',
  title: 'Prepare an AEAT submission',
  description:
    'Build the SOAP request the Spanish tax agency expects for an invoice already registered '
    + 'here, and offer it as a file to download. Defaults to the most recent invoice. '
    + 'This prepares the submission only; it never sends it.',
  inputSchema: {
    type: 'object',
    properties: {
      invoiceId: {
        type: 'string',
        description: 'Serial of the invoice, e.g. DEMO-2026-003. Defaults to the most recent one.',
      },
      vatTreatment: {
        type: 'string',
        description:
          'Rarely needed. Invoices already record why they charge no VAT, so this only '
          + 'applies to older records made before that was stored, or to override one. '
          + 'E1 to E8 for an exempt operation, or N1 or N2 for one outside the scope of VAT.',
        enum: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'N1', 'N2'],
      },
    },
  },
  annotations: { readOnlyHint: true },
  execute: async (input = {} as Input) => {
    const { invoiceId } = input;
    const mode = await getMode();
    const profile = await getProfile(mode);

    if (!isProfileComplete(profile)) {
      return text(`${modeNotice(mode)} Nothing to submit: this profile has no name or tax ID.`);
    }

    const invoices = await listInvoices(mode);
    const index = invoiceId
      ? invoices.findIndex(i => i.id === invoiceId)
      : invoices.length - 1;

    if (index < 0) {
      return text(
        `${modeNotice(mode)} No invoice ${invoiceId ? `"${invoiceId}"` : 'at all'} here. `
        + `Registered: ${invoices.map(i => i.id).join(', ') || 'none'}.`);
    }

    const invoice = invoices[index];
    if (!invoice.hash || !invoice.generatedAt) {
      return text(
        `${modeNotice(mode)} ${invoice.id} has no stored fingerprint or generation time, so a `
        + 'valid submission cannot be rebuilt from it. Register it again.');
    }

    // The invoice records why it charges no VAT, because register_invoice asks at
    // the moment the invoice is created. Only records made before that was stored
    // reach the branch that has to ask again.
    const stated = input.vatTreatment ?? invoice.vatTreatment;

    let taxTreatment: TaxTreatment;
    if (invoice.vatRate > 0) {
      taxTreatment = { kind: 'subject' };
    } else if (!stated) {
      return text(
        `${modeNotice(mode)} ${invoice.id} charges no VAT, so the record has to say why, and that `
        + 'cannot be worked out from the amount. Ask the person whether the operation is exempt '
        + `(${EXEMPTION_CODES.join(', ')}) or outside the scope of VAT (N1, N2), then call this `
        + 'tool again with vatTreatment set. Guessing would misclassify the operation to the tax agency.',
      );
    } else if (isExemptionCode(stated)) {
      taxTreatment = { kind: 'exempt', code: stated };
    } else if (isNotSubjectCode(stated)) {
      taxTreatment = { kind: 'notSubject', code: stated };
    } else {
      return text(
        `${modeNotice(mode)} "${stated}" is not a VAT treatment code. `
        + `Use one of ${EXEMPTION_CODES.join(', ')}, N1 or N2.`);
    }

    const envelope = buildSubmissionEnvelope({
      invoice,
      profile,
      previous: index > 0 ? invoices[index - 1] : null,
      generatedAt: invoice.generatedAt,
      softwareVersion: SOFTWARE_VERSION,
      taxTreatment,
    });

    const filename = `${invoice.id.replace(/\//g, '-')}-verifactu.xml`;
    renderSubmission({
      invoiceId: invoice.id,
      filename,
      envelope,
      endpoint: TEST_ENDPOINT,
      instructions: submissionInstructions(TEST_ENDPOINT, filename),
    });

    return text(
      `${modeNotice(mode)} Submission for ${invoice.id} is ready and on screen, with a download button.\n`
      + `File: ${filename}\n`
      + `Endpoint: ${TEST_ENDPOINT} (AEAT external test environment)\n`
      + `Fingerprint carried: ${invoice.hash}\n`
      + `Generated at: ${invoice.generatedAt} — the same instant that went into the fingerprint\n\n`
      + 'There is a Send button on the page. It is an ordinary form post, which is a navigation '
      + 'and so is not subject to CORS, and the browser asks which certificate to use. '
      + 'Nothing can answer that prompt on the person\'s behalf — not this page, not an agent. '
      + 'Do not tell them you have sent it; they send it.',
    );
  },
};
