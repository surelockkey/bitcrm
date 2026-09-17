import { DynamoDbService } from '@bitcrm/shared';
import type { CallTag } from '@bitcrm/types';
import { CallTagsRepository } from '../../src/call-tags/call-tags.repository';

/**
 * Call tags live in the calls table as one item collection —
 * PK CALLTAG#ALL, SK CALLTAG#<id> — with no GSI keys, so a catalog row can
 * never surface in the AgentIndex / AllCallsIndex / PartyIndex call log.
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
  const repo = new CallTagsRepository({ client } as unknown as DynamoDbService);
  return { repo, sent };
}

const tag: CallTag = {
  id: 't1',
  name: 'SPAM CALLER',
  color: 'red',
  priority: 0,
  active: true,
  externalId: 'workiz:tag:645312',
  createdBy: 'u1',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('CallTagsRepository', () => {
  it('writes the row under the catalog partition with no index keys', async () => {
    const { repo, sent } = makeRepo();
    await repo.create(tag);

    const input = sent[0].input;
    expect(input.Item).toMatchObject({
      PK: 'CALLTAG#ALL',
      SK: 'CALLTAG#t1',
      id: 't1',
      name: 'SPAM CALLER',
      externalId: 'workiz:tag:645312',
    });
    expect(Object.keys(input.Item)).not.toEqual(
      expect.arrayContaining(['GSI1PK', 'GSI2PK', 'GSI3PK']),
    );
    expect(input.ConditionExpression).toBe('attribute_not_exists(SK)');
  });

  it('lists the whole catalog from the one partition', async () => {
    const { repo, sent } = makeRepo([
      { Items: [{ PK: 'CALLTAG#ALL', SK: 'CALLTAG#t1', ...tag }] },
    ]);
    const all = await repo.listAll();

    expect(sent[0].input.KeyConditionExpression).toBe('PK = :pk');
    expect(sent[0].input.ExpressionAttributeValues[':pk']).toBe('CALLTAG#ALL');
    expect(sent[0].input.IndexName).toBeUndefined();
    // Tens of items, and the read decides whether tagging a call with a
    // just-created tag is a 404 — pay for a consistent read.
    expect(sent[0].input.ConsistentRead).toBe(true);
    expect(all).toEqual([tag]);
  });

  it('reads one by its key', async () => {
    const { repo, sent } = makeRepo([{ Item: { PK: 'CALLTAG#ALL', SK: 'CALLTAG#t1', ...tag } }]);
    const got = await repo.get('t1');

    expect(sent[0].input.Key).toEqual({ PK: 'CALLTAG#ALL', SK: 'CALLTAG#t1' });
    expect(got).toEqual(tag);
  });

  it('returns null for a missing tag', async () => {
    const { repo } = makeRepo([{}]);
    expect(await repo.get('nope')).toBeNull();
  });

  it('tolerates a minimal imported row: id from the SK, active by default', async () => {
    // The generator may write only what Workiz has — a name, a color and the
    // externalId — so every derived field needs a fallback on read.
    const { repo } = makeRepo([
      {
        Items: [
          {
            PK: 'CALLTAG#ALL',
            SK: 'CALLTAG#imported-1',
            name: 'Lines Testing',
            color: 'pink',
            externalId: 'workiz:tag:645320',
          },
        ],
      },
    ]);
    const [got] = await repo.listAll();

    expect(got).toMatchObject({
      id: 'imported-1',
      name: 'Lines Testing',
      color: 'pink',
      priority: 0,
      active: true,
      externalId: 'workiz:tag:645320',
      createdBy: 'import',
    });
  });
});
