import { ACCOUNT_COUNTERS_PK, COUNTERS_SK } from 'src/common/constants/dynamo.constants';
import { NumberingBehindError, NumberingRepository } from 'src/numbering/numbering.repository';

/** A DynamoDB client that records every command and answers what the test says. */
function fakeDb(answer: (cmd: { input: Record<string, unknown> }) => unknown = () => ({})) {
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  return {
    sent,
    client: {
      send: jest.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        sent.push({ name: cmd.constructor.name, input: cmd.input });
        return answer(cmd);
      }),
    },
  };
}

/**
 * The account counters row (`COUNTERS#ACCOUNT` / `COUNTERS`) now carries
 * `lastInvoiceNumber` and `lastEstimateNumber` — the last number handed to a
 * CLIENT invoice / estimate — beside the legacy `documentSeq` they replace.
 * Every operation is ONE conditional UpdateItem, so two requests can never
 * get the same number and a "next number" can never be set below one in use.
 */
describe('NumberingRepository', () => {
  it('reads the counters row strongly consistent, empty when it does not exist', async () => {
    const db = fakeDb(() => ({}));
    const row = await new NumberingRepository(db as never).read();
    expect(row).toEqual({});
    expect(db.sent[0]).toMatchObject({
      name: 'GetCommand',
      input: { Key: { PK: ACCOUNT_COUNTERS_PK, SK: COUNTERS_SK }, ConsistentRead: true },
    });
  });

  it('hands out the next invoice number with if_not_exists + 1 in one atomic update', async () => {
    const db = fakeDb(() => ({ Attributes: { lastInvoiceNumber: 85427 } }));
    const n = await new NumberingRepository(db as never).allocate('invoice', 85426);
    expect(n).toBe(85427);
    expect(db.sent[0]).toMatchObject({
      name: 'UpdateCommand',
      input: {
        Key: { PK: ACCOUNT_COUNTERS_PK, SK: COUNTERS_SK },
        UpdateExpression: 'SET #n = if_not_exists(#n, :seed) + :one',
        ExpressionAttributeNames: { '#n': 'lastInvoiceNumber' },
        ExpressionAttributeValues: { ':seed': 85426, ':one': 1 },
        ReturnValues: 'UPDATED_NEW',
      },
    });
  });

  it('keeps the estimate counter apart from the invoice one', async () => {
    const db = fakeDb(() => ({ Attributes: { lastEstimateNumber: 1142 } }));
    const n = await new NumberingRepository(db as never).allocate('estimate', 1141);
    expect(n).toBe(1142);
    expect(db.sent[0]!.input).toMatchObject({ ExpressionAttributeNames: { '#n': 'lastEstimateNumber' } });
  });

  it('sets the last number only while nothing higher was handed out, stamping who and when', async () => {
    const db = fakeDb();
    await new NumberingRepository(db as never).setLast('invoice', 85426, 'u-9', '2026-10-09T12:00:00.000Z');
    expect(db.sent[0]).toMatchObject({
      name: 'UpdateCommand',
      input: {
        Key: { PK: ACCOUNT_COUNTERS_PK, SK: COUNTERS_SK },
        UpdateExpression: 'SET #n = :last, numberingUpdatedBy = :by, numberingUpdatedAt = :at',
        ConditionExpression: 'attribute_not_exists(#n) OR #n <= :last',
        ExpressionAttributeNames: { '#n': 'lastInvoiceNumber' },
        ExpressionAttributeValues: { ':last': 85426, ':by': 'u-9', ':at': '2026-10-09T12:00:00.000Z' },
      },
    });
  });

  it('reports a number already past the one being set as NumberingBehindError, other failures as they are', async () => {
    const behind = fakeDb(() => {
      throw Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
    });
    await expect(new NumberingRepository(behind as never).setLast('estimate', 1000, 'u', 't')).rejects.toBeInstanceOf(
      NumberingBehindError,
    );
    const down = fakeDb(() => {
      throw Object.assign(new Error('boom'), { name: 'ProvisionedThroughputExceededException' });
    });
    await expect(new NumberingRepository(down as never).setLast('estimate', 1000, 'u', 't')).rejects.toThrow('boom');
  });
});
