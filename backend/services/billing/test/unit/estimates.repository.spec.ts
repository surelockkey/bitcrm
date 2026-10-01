import type { Estimate } from '@bitcrm/types';
import { EstimatesRepository } from 'src/estimates/estimates.repository';
import { ACCOUNT_COUNTERS_PK, COUNTERS_SK } from 'src/common/constants/dynamo.constants';
import { NOW } from './mocks';

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

const estimate = (over: Partial<Estimate> = {}): Estimate =>
  ({
    id: 'e1',
    number: 'K4T9ZW-1',
    dealId: 'deal-1',
    dealNumber: 'K4T9ZW',
    contactId: 'contact-1',
    status: 'unsent',
    estimateDate: '2026-09-16',
    totals: {} as never,
    version: 1,
    createdBy: 'u-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as Estimate;

type PutItems = Array<{ Put: { Item: Record<string, unknown> } }>;

describe('EstimatesRepository keys', () => {
  it("writes the DealIndex keys for a job's estimate", async () => {
    const db = fakeDb();
    await new EstimatesRepository(db as never).create(estimate(), []);
    const put = (db.sent[0]!.input.TransactItems as PutItems)[0]!.Put.Item;
    expect(put).toMatchObject({ GSI3PK: 'DEAL#deal-1', GSI3SK: `ESTIMATE#${NOW}#e1`, GSI2PK: 'CONTACT#contact-1' });
  });

  it('leaves the DealIndex sparse for a client estimate (no job): no GSI3 keys at all', async () => {
    const db = fakeDb();
    const { dealId: _d, dealNumber: _n, ...noJob } = estimate({ number: '1001' });
    await new EstimatesRepository(db as never).create(noJob as Estimate, []);
    const put = (db.sent[0]!.input.TransactItems as PutItems)[0]!.Put.Item;
    expect(put).not.toHaveProperty('GSI3PK');
    expect(put).not.toHaveProperty('GSI3SK');
    expect(put).not.toHaveProperty('dealId');
    // Still listed for the client and in the global list.
    expect(put).toMatchObject({ GSI1PK: 'ESTIMATES', GSI2PK: 'CONTACT#contact-1', GSI2SK: `ESTIMATE#${NOW}#e1` });
  });

  it('takes stub numbers from the account-wide counter, not a job counter', async () => {
    const db = fakeDb(() => ({ Attributes: { documentSeq: 141 } }));
    const seq = await new EstimatesRepository(db as never).nextAccountSeq();
    expect(seq).toBe(141);
    expect(db.sent[0]!.input).toMatchObject({
      Key: { PK: ACCOUNT_COUNTERS_PK, SK: COUNTERS_SK },
      UpdateExpression: 'ADD documentSeq :one',
    });
  });
});
