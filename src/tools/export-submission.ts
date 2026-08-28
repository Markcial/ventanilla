import { text, type ToolDefinition } from '../lib/webmcp';
import { modeNotice } from '../lib/mode';
import { prepareSubmission } from '../lib/actions';
import { EXEMPTION_CODES } from '../lib/soap';
import { renderSubmission } from '../lib/render';

interface Input { invoiceId?: string; vatTreatment?: string }

const SOFTWARE_VERSION = '0.1.0';

/**
 * The end of what an agent can do alone.
 *
 * The envelope is prepared here and the page offers a Send button, which is an
 * ordinary form post: a navigation, so CORS does not apply, and the browser asks
 * which certificate to use. That prompt cannot be answered by script. The agent
 * does everything up to it and stops.
 *
 * Shares lib/actions with the Prepare button on each invoice.
 */
export const exportSubmission: ToolDefinition<Input> = {
  name: 'export_submission',
  title: 'Prepare an AEAT submission',
  description:
    'Build the SOAP request the Spanish tax agency expects for an invoice already registered '
    + 'here, and show it on the page with a button that sends it. Defaults to the most recent '
    + 'invoice. This prepares the submission; the person sends it with their certificate.',
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
          'Rarely needed. Invoices already record why they charge no VAT, so this only applies '
          + 'to older records made before that was stored, or to override one. '
          + `${EXEMPTION_CODES.join(', ')} for an exempt operation, N1 or N2 for one outside the `
          + 'scope of VAT.',
        enum: [...EXEMPTION_CODES, 'N1', 'N2'],
      },
    },
  },
  annotations: { readOnlyHint: true },
  execute: async (input = {} as Input) => {
    const result = await prepareSubmission(input.invoiceId, SOFTWARE_VERSION, input.vatTreatment);
    if (!result.ok) return text(`${modeNotice(result.mode)} ${result.reason}`);

    const view = result.value;
    renderSubmission({ ...view, mode: result.mode });

    return text(
      `${modeNotice(result.mode)} Submission for ${view.invoiceId} is ready and on screen.\n`
      + `File: ${view.filename}\n`
      + `Endpoint: ${view.endpoint} (AEAT external test environment)\n\n`
      + 'There is a Send button on the page. It is an ordinary form post, which is a navigation '
      + 'and so is not subject to CORS, and the browser asks which certificate to use. '
      + "Nothing can answer that prompt on the person's behalf — not this page, not an agent. "
      + 'Do not tell them you have sent it; they send it.',
    );
  },
};
