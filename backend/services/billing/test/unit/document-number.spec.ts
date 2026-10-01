import { STANDALONE_NUMBER_BASE, standaloneDocumentNumber } from 'src/common/document-number';

/**
 * A document that belongs to a client and no job (Workiz's "stub") is numbered
 * from one account-wide counter, so an estimate and an invoice never share a
 * number and the numbers look like Workiz's (1141, not 1).
 */
describe('standaloneDocumentNumber', () => {
  it('offsets the counter so the first numbers already have four digits', () => {
    expect(STANDALONE_NUMBER_BASE).toBe(1000);
    expect(standaloneDocumentNumber(1)).toBe('1001');
    expect(standaloneDocumentNumber(141)).toBe('1141');
  });

  it('refuses a counter value that is not a positive integer', () => {
    expect(() => standaloneDocumentNumber(0)).toThrow();
    expect(() => standaloneDocumentNumber(1.5)).toThrow();
    expect(() => standaloneDocumentNumber(Number.NaN)).toThrow();
  });
});
