import {
  isReferencedByDeal,
  equals,
  listContains,
  mapKeyExists,
} from '../../../src/common/utils/is-referenced';

/**
 * "Is any job still naming this catalog entry?" decides whether the entry may
 * be deleted or must only be archived. Four catalogs asked it with `Limit: 1` —
 * DynamoDB then reads ONE row of a 1.25M-row table and applies the filter
 * afterwards, so the answer was very nearly always "no". A job type in daily
 * use could be deleted, and every job naming it would lose its name.
 *
 * The three catalogs ask in three shapes — a plain attribute, a list of tags,
 * a key inside the custom-fields map — so the walk takes the filter as given
 * and only handles the paging.
 */
describe('isReferencedByDeal', () => {
  const send = (pages: { Items?: unknown[]; LastEvaluatedKey?: Record<string, unknown> }[]) =>
    jest.fn().mockImplementation(() => Promise.resolve(pages.shift() ?? { Items: [] }));

  const ask = (client: jest.Mock, options = {}) =>
    isReferencedByDeal({ send: client } as never, 'T', equals('jobTypeId', 'jt-1'), options);

  it('finds a reference that is not on the first page', async () => {
    const client = send([
      { Items: [], LastEvaluatedKey: { PK: 'p1' } },
      { Items: [], LastEvaluatedKey: { PK: 'p2' } },
      { Items: [{ id: 'deal-1' }] },
    ]);

    await expect(ask(client)).resolves.toBe(true);
    expect(client).toHaveBeenCalledTimes(3);
  });

  it('says no only after the table has ended', async () => {
    const client = send([{ Items: [], LastEvaluatedKey: { PK: 'p1' } }, { Items: [] }]);

    await expect(ask(client)).resolves.toBe(false);
    expect(client).toHaveBeenCalledTimes(2);
  });

  it('stops at the first hit rather than reading on', async () => {
    const client = send([{ Items: [{ id: 'deal-1' }], LastEvaluatedKey: { PK: 'p1' } }]);

    await expect(ask(client)).resolves.toBe(true);
    expect(client).toHaveBeenCalledTimes(1);
  });

  it('reads a whole page at a time, not one row', async () => {
    const client = send([{ Items: [] }]);

    await ask(client);

    expect(client.mock.calls[0][0].input.Limit).toBeGreaterThan(1);
  });

  it('gives up after a bounded walk rather than scanning forever', async () => {
    const client = jest.fn().mockResolvedValue({ Items: [], LastEvaluatedKey: { PK: 'x' } });

    await expect(ask(client, { maxPages: 3 })).resolves.toBe(true);
    expect(client).toHaveBeenCalledTimes(3);
  });

  it('carries the filter it was given, whatever its shape', async () => {
    const client = send([{ Items: [] }]);

    await isReferencedByDeal({ send: client } as never, 'T', listContains('tagIds', 'tag-1'));

    const input = client.mock.calls[0][0].input;
    expect(input.FilterExpression).toBe('contains(#ref, :id)');
    expect(input.ExpressionAttributeNames).toEqual({ '#ref': 'tagIds' });
    expect(input.ExpressionAttributeValues).toEqual({ ':id': 'tag-1' });
  });
});

describe('the three shapes a catalog is referenced in', () => {
  it('a plain attribute holds the id', () => {
    expect(equals('jobTypeId', 'jt-1')).toEqual({
      expression: '#ref = :id',
      names: { '#ref': 'jobTypeId' },
      values: { ':id': 'jt-1' },
    });
  });

  it('a list holds the id among others', () => {
    expect(listContains('tagIds', 'tag-1').expression).toBe('contains(#ref, :id)');
  });

  it('a map holds the id as a key, so there is no value to compare', () => {
    expect(mapKeyExists('customFields', 'cf-1')).toEqual({
      expression: 'attribute_exists(#ref.#key)',
      names: { '#ref': 'customFields', '#key': 'cf-1' },
      values: undefined,
    });
  });
});
