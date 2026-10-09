import { DynamoDbService } from '@bitcrm/shared';
import type { BlockedCaller } from '@bitcrm/types';
import { BlockedCallersRepository } from '../../src/blocked-callers/blocked-callers.repository';

/**
 * Blocked callers live in the calls table as one item collection — the shape
 * the Workiz import already writes (workiz-data-parser, telephony.md §4.4):
 * PK BLOCKED#ALL, SK = the E.164 number, no GSI keys, so a row can never
 * surface in the AgentIndex / AllCallsIndex / PartyIndex call log.
 */
type SentCommand = { input: Record<string, any> };

function makeRepo(responses: Array<Record<string, any>> = [{}]) {
  const sent: SentCommand[] = [];
  let i = 0;
  const client = {
    send: jest.fn(async (cmd: SentCommand) => {
      sent.push(cmd);
      const res = responses[Math.min(i, responses.length - 1)] ?? {};
      i += 1;
      return res;
    }),
  };
  const repo = new BlockedCallersRepository({ client } as unknown as DynamoDbService);
  return { repo, sent };
}

const row: BlockedCaller = {
  id: 'b1',
  number: '+12147917112',
  comment: 'keeps calling about a key he broke',
  createdBy: 'u1',
  createdAt: '2026-10-09T10:00:00.000Z',
};

describe('BlockedCallersRepository', () => {
  it('writes the row under the one partition, keyed by the number, with no index keys', async () => {
    const { repo, sent } = makeRepo();
    await repo.create(row);

    const input = sent[0].input;
    expect(input.Item).toMatchObject({
      PK: 'BLOCKED#ALL',
      SK: '+12147917112',
      id: 'b1',
      number: '+12147917112',
      comment: 'keeps calling about a key he broke',
      createdBy: 'u1',
    });
    expect(Object.keys(input.Item)).not.toEqual(expect.arrayContaining(['GSI1PK', 'GSI2PK', 'GSI3PK']));
    // Blocking a number twice is a conflict, not a silent overwrite of the first comment.
    expect(input.ConditionExpression).toBe('attribute_not_exists(SK)');
  });

  it('lists the whole partition, following the cursor', async () => {
    const { repo, sent } = makeRepo([
      { Items: [{ PK: 'BLOCKED#ALL', SK: '+12147917112', ...row }], LastEvaluatedKey: { PK: 'BLOCKED#ALL', SK: '+12147917112' } },
      { Items: [{ PK: 'BLOCKED#ALL', SK: '+12037601092', id: 'b2', number: '+12037601092', createdAt: '2021-07-21T14:06:59.000Z', createdBy: 'workiz-import', externalId: 'workiz:blocked_caller:116719' }] },
    ]);
    const rows = await repo.listAll();

    expect(sent).toHaveLength(2);
    expect(sent[0].input).toMatchObject({
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'BLOCKED#ALL' },
    });
    expect(sent[1].input.ExclusiveStartKey).toEqual({ PK: 'BLOCKED#ALL', SK: '+12147917112' });
    expect(rows).toEqual([
      row,
      {
        id: 'b2',
        number: '+12037601092',
        createdAt: '2021-07-21T14:06:59.000Z',
        createdBy: 'workiz-import',
        externalId: 'workiz:blocked_caller:116719',
      },
    ]);
    // The keys never leak into the entity, and an empty comment is absent, not "".
    expect(rows[1]).not.toHaveProperty('PK');
    expect(rows[1]).not.toHaveProperty('comment');
  });

  it('tolerates an imported row with no id: the number names it', async () => {
    const { repo } = makeRepo([{ Items: [{ PK: 'BLOCKED#ALL', SK: '+12037601092', number: '+12037601092', comment: '' }] }]);
    const [only] = await repo.listAll();
    expect(only.id).toBe('+12037601092');
    expect(only.comment).toBeUndefined();
    expect(only.createdBy).toBe('import');
  });

  it('reads one number with a GetItem on its key', async () => {
    const { repo, sent } = makeRepo([{ Item: { PK: 'BLOCKED#ALL', SK: '+12147917112', ...row } }, {}]);
    expect(await repo.get('+12147917112')).toEqual(row);
    expect(sent[0].input.Key).toEqual({ PK: 'BLOCKED#ALL', SK: '+12147917112' });
    expect(await repo.get('+15550000000')).toBeNull();
  });

  it('removes a number and says whether there was one', async () => {
    const { repo, sent } = makeRepo([{ Attributes: { PK: 'BLOCKED#ALL', SK: '+12147917112' } }, {}]);
    expect(await repo.remove('+12147917112')).toBe(true);
    expect(sent[0].input).toMatchObject({ Key: { PK: 'BLOCKED#ALL', SK: '+12147917112' }, ReturnValues: 'ALL_OLD' });
    expect(await repo.remove('+12147917112')).toBe(false);
  });
});
