import {
  countRows,
  type CountReadInput,
  type CountReadOutput,
} from '../../../src/dynamodb/count-rows';

type Read = jest.Mock<Promise<CountReadOutput>, [CountReadInput]>;

/**
 * How many rows a list holds, for "Page 2 of 7".
 *
 * `Select: 'COUNT'` brings back no item bodies, but it still walks the index
 * or table a megabyte at a time and charges for what it traverses. Two bounds
 * keep that from turning a page load into a full-table read: a ceiling on the
 * tally, and a ceiling on the reads spent reaching it. Either one turns the
 * answer into "at least", which the panel renders as `7+`.
 */
describe('countRows', () => {
  const page = (count: number, last?: Record<string, unknown>): Promise<CountReadOutput> =>
    Promise.resolve({ Count: count, LastEvaluatedKey: last });

  it('sums every page the walk returns', async () => {
    const pages = [page(120, { PK: 'a' }), page(120, { PK: 'b' }), page(37)];
    const read: Read = jest.fn((_: CountReadInput) => pages.shift()!);

    expect(await countRows(read)).toEqual({ total: 277, atLeast: false });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('resumes each read where the previous one stopped', async () => {
    const pages = [page(1, { PK: 'a' }), page(1, { PK: 'b' }), page(1)];
    const read: Read = jest.fn((_: CountReadInput) => pages.shift()!);

    await countRows(read);

    expect(read.mock.calls[0][0].ExclusiveStartKey).toBeUndefined();
    expect(read.mock.calls[1][0].ExclusiveStartKey).toEqual({ PK: 'a' });
    expect(read.mock.calls[2][0].ExclusiveStartKey).toEqual({ PK: 'b' });
  });

  it('an empty list counts zero, and knows it exactly', async () => {
    const read: Read = jest.fn((_: CountReadInput) => page(0));
    expect(await countRows(read)).toEqual({ total: 0, atLeast: false });
  });

  // The ceiling: past it the exact number stops being worth the read. A list
  // of 40,000 renders "500+" pages, and nobody pages to the end of that.
  it('stops at the cap and says the tally is a floor', async () => {
    const read: Read = jest.fn((_: CountReadInput) => page(400, { PK: 'more' }));

    expect(await countRows(read, { cap: 1000 })).toEqual({ total: 1200, atLeast: true });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('a list that ends exactly on the cap is exact, not a floor', async () => {
    const pages = [page(500, { PK: 'a' }), page(500)];
    const read: Read = jest.fn((_: CountReadInput) => pages.shift()!);

    expect(await countRows(read, { cap: 1000 })).toEqual({ total: 1000, atLeast: false });
  });

  // The other ceiling, and the one that matters for a filtered Scan: a sparse
  // table can hand back page after page of near-nothing, and the request must
  // not walk it all. Bounded work, honest "+".
  it('gives up after maxReads rather than walk the whole table', async () => {
    const read: Read = jest.fn((_: CountReadInput) => page(2, { PK: 'more' }));

    expect(await countRows(read, { maxReads: 4 })).toEqual({ total: 8, atLeast: true });
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('a walk that ends within maxReads is exact', async () => {
    const pages = [page(5, { PK: 'a' }), page(5)];
    const read: Read = jest.fn((_: CountReadInput) => pages.shift()!);

    expect(await countRows(read, { maxReads: 4 })).toEqual({ total: 10, atLeast: false });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('treats a page with no Count as zero rather than NaN', async () => {
    const pages = [Promise.resolve<CountReadOutput>({ LastEvaluatedKey: { PK: 'a' } }), page(3)];
    const read: Read = jest.fn((_: CountReadInput) => pages.shift()!);

    expect(await countRows(read)).toEqual({ total: 3, atLeast: false });
  });
});
