/**
 * Demo mode and real mode.
 *
 * A judge opening this page has never registered as a Spanish freelancer, has no
 * invoices and no certificate. Demo mode has to work for them on first load.
 * Real mode is for someone using their own details and their own certificate.
 *
 * The two never share data: profiles are keyed by mode and invoices carry a mode
 * field, so nothing entered in one can surface in the other.
 *
 * Switching is deliberately NOT exposed as a tool. An agent that could move a
 * person from demo to real could get them to sign something real while they
 * believed they were trying a demo. The switch stays a human action.
 */
export type Mode = 'demo' | 'real';

export const MODES: Mode[] = ['demo', 'real'];

export function isMode(value: unknown): value is Mode {
  return value === 'demo' || value === 'real';
}

export const MODE_LABEL: Record<Mode, string> = {
  demo: 'Demo',
  real: 'Real',
};

export const MODE_BLURB: Record<Mode, string> = {
  demo:
    'Sample freelancer, sample invoices. Nothing here belongs to anyone and nothing is filed. '
    + 'Everything is computed with the same code real mode uses.',
  real:
    'Your details, your invoices, your certificate. Documents are generated for real and signed '
    + 'with AutoFirma. Nothing is submitted to the tax agency.',
};

/**
 * Appended to every tool result. An agent must never be able to report a
 * simulated filing as a real one, so the mode travels with the answer rather
 * than living only in the UI.
 */
export function modeNotice(mode: Mode): string {
  return mode === 'demo'
    ? '[demo mode — sample data, nothing filed]'
    : '[real mode — your own data; documents are prepared and signed, never submitted]';
}

/**
 * Neither mode submits anything to the tax agency. Filing on someone's behalf
 * requires registered *colaborador social* status, which this is not. Stated in
 * one place so no tool can drift away from it.
 */
export const NEVER_SUBMITS =
  'This never submits anything to the AEAT. Filing on another person\'s behalf requires '
  + 'registered colaborador social status.';
