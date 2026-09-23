import {
  scanPage,
  type ScanReadInput,
  type ScanReadOutput,
} from '../../../src/dynamodb/scan-page';

type Read = jest.Mock<Promise<ScanReadOutput<number>>, [ScanReadInput]>;

/**
 * DynamoDB applies `Limit` to the rows it *reads*, and the filter only
 * afterwards. In a single-table design that makes a filtered Scan return a
 * fraction of the page: after the Workiz import the users table held 6,787
 * rows of which 585 were user records, so `limit: 100` came back with nine
 * users — and every screen that resolves a name through the directory showed
 * "Unknown technician".
 *
 * A page must therefore be filled, not merely requested: keep reading until it
 * holds `limit` rows or the table ends.
 */
describe('scanPage', () => {
  const page = (
    items: number[],
    last?: Record<string, unknown>,
  ): Promise<ScanReadOutput<number>> => Promise.resolve({ Items: items, LastEvaluatedKey: last });

  it('keeps reading until the page is full', async () => {
    const pages = [
      page([1, 2, 3], { PK: 'a' }),
      page([4, 5], { PK: 'b' }),
      page([6, 7, 8, 9, 10], { PK: 'c' }),
    ];
    const read: Read = jest.fn((_: ScanReadInput) => pages.shift()!);

    const out = await scanPage(read, 10);

    expect(out.items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('asks for more rows than the caller wants, because the filter will drop some', async () => {
    const read: Read = jest.fn((_: ScanReadInput) => page([1], { PK: 'a' }));
    await scanPage(read, 10, { maxReads: 1 });
    expect(read.mock.calls[0][0].Limit).toBeGreaterThan(10);
  });

  it('stops at the end of the table and reports no cursor', async () => {
    const read: Read = jest.fn((_: ScanReadInput) => page([1, 2], undefined));
    const out = await scanPage(read, 10);
    expect(out.items).toEqual([1, 2]);
    expect(out.lastKey).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('hands back the key of the last row it read, so the next page starts there', async () => {
    const pages = [page([1], { PK: 'a' }), page([2, 3], { PK: 'b' })];
    const read: Read = jest.fn((_: ScanReadInput) => pages.shift()!);
    const out = await scanPage(read, 3);
    expect(out.lastKey).toEqual({ PK: 'b' });
  });

  it('never returns more than the caller asked for, and points the cursor at what it kept', async () => {
    const read: Read = jest.fn((_: ScanReadInput) => page([1, 2, 3, 4, 5], { PK: 'far' }));
    const out = await scanPage(read, 3, { keyOf: (i: number) => ({ PK: `k${i}` }) });
    expect(out.items).toEqual([1, 2, 3]);
    expect(out.lastKey).toEqual({ PK: 'k3' });
  });

  it('gives up after a bounded number of reads rather than walking a huge table forever', async () => {
    const read: Read = jest.fn((_: ScanReadInput) => page([], { PK: 'x' }));
    const out = await scanPage(read, 100, { maxReads: 4 });
    expect(read).toHaveBeenCalledTimes(4);
    // A cursor is still returned: the caller can carry on where this left off.
    expect(out.lastKey).toEqual({ PK: 'x' });
  });

  it('threads the previous page cursor into the first read', async () => {
    const read: Read = jest.fn((_: ScanReadInput) => page([1], undefined));
    await scanPage(read, 10, { startKey: { PK: 'resume' } });
    expect(read.mock.calls[0][0].ExclusiveStartKey).toEqual({ PK: 'resume' });
  });
});
