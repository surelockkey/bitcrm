import { earliestMonth, transferIndexKeysToWrite } from 'src/transfers/transfer-index.backfill';

/**
 * Рухи, записані до місячного індексу, не мають GSI1-ключів — у списку їх
 * нема, доки бекфіл їх не підшиє і не опустить `firstMonth` до найстаршого.
 */
describe('transferIndexKeysToWrite', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    PK: 'TRANSFER#t-1',
    SK: 'METADATA',
    id: 't-1',
    createdAt: '2026-03-04T05:06:07.000Z',
    ...overrides,
  });

  it('files a transfer row without keys under its month, by time', () => {
    expect(transferIndexKeysToWrite(row())).toEqual({
      GSI1PK: 'TRANSFERS#2026-03',
      GSI1SK: '2026-03-04T05:06:07.000Z#t-1',
    });
  });

  it('leaves a row that already carries the right keys alone', () => {
    expect(
      transferIndexKeysToWrite(row({ GSI1PK: 'TRANSFERS#2026-03', GSI1SK: '2026-03-04T05:06:07.000Z#t-1' })),
    ).toBeNull();
  });

  it('rewrites keys that are wrong', () => {
    expect(transferIndexKeysToWrite(row({ GSI1PK: 'TRANSFERS#2026-04', GSI1SK: 'x' }))).toEqual({
      GSI1PK: 'TRANSFERS#2026-03',
      GSI1SK: '2026-03-04T05:06:07.000Z#t-1',
    });
  });

  it('takes the id off the key when the row carries none', () => {
    expect(transferIndexKeysToWrite(row({ id: undefined }))?.GSI1SK).toBe('2026-03-04T05:06:07.000Z#t-1');
  });

  it('skips a row with no usable createdAt — it has no month to be filed under', () => {
    expect(transferIndexKeysToWrite(row({ createdAt: undefined }))).toBeNull();
    expect(transferIndexKeysToWrite(row({ createdAt: 'yesterday' }))).toBeNull();
  });

  it('skips what is not a transfer row: a destination reference, or another entity', () => {
    expect(transferIndexKeysToWrite(row({ SK: 'ENTITY_REF#container#c-1' }))).toBeNull();
    expect(transferIndexKeysToWrite(row({ PK: 'TRANSFERS#INDEX' }))).toBeNull();
    expect(transferIndexKeysToWrite(row({ PK: 'PRODUCT#p-1' }))).toBeNull();
  });
});

describe('earliestMonth', () => {
  it('answers the oldest month of the rows filed', () => {
    expect(
      earliestMonth(['2026-03-04T00:00:00.000Z', '2025-12-31T23:59:59.000Z', '2026-09-01T00:00:00.000Z']),
    ).toBe('2025-12');
  });

  it('answers undefined for no rows', () => {
    expect(earliestMonth([])).toBeUndefined();
  });
});
