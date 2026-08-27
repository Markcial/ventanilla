import { describe, it, expect } from 'vitest';
import { normaliseNif } from '../src/lib/db';

/**
 * A tax ID typed in lowercase validates against the schema — NIFType only
 * constrains the length to 9 — and then fails against the agency's census,
 * because the certificate signing the submission carries the uppercase form.
 * The schema will not catch this, so a test does.
 */
describe('normaliseNif', () => {
  it('uppercases the check letter', () => {
    expect(normaliseNif('89890001k')).toBe('89890001K');
  });
  it('uppercases a leading letter too', () => {
    expect(normaliseNif('b12345674')).toBe('B12345674');
  });
  it('trims surrounding whitespace', () => {
    expect(normaliseNif('  89890001K  ')).toBe('89890001K');
  });
  it('strips spaces and dashes people type', () => {
    expect(normaliseNif('89890001-K')).toBe('89890001K');
    expect(normaliseNif('8989 0001 K')).toBe('89890001K');
  });
  it('leaves a well formed value alone', () => {
    expect(normaliseNif('89890001K')).toBe('89890001K');
  });
  it('keeps the result nine characters for a valid input', () => {
    expect(normaliseNif(' 89890001k ')).toHaveLength(9);
  });
});
