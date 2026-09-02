import { DynamoDbService } from '@bitcrm/shared';
import { NumberSettingsRepository } from '../../src/numbers/number-settings.repository';

/**
 * Per-number settings live in the calls table as one small item collection
 * (PK NUMSET#ALL, SK = the E.164 number) — a workspace owns a handful of
 * numbers, so listing them is a single-partition query.
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
  const repo = new NumberSettingsRepository({
    client,
  } as unknown as DynamoDbService);
  return { repo, sent };
}

describe('NumberSettingsRepository', () => {
  it('stores the source assignment under the number', async () => {
    const { repo, sent } = makeRepo();
    await repo.put('+15412830739', { sourceId: 'src-google-ads' }, 'u1');

    const input = sent[0].input;
    expect(input.Key).toEqual({ PK: 'NUMSET#ALL', SK: '+15412830739' });
    expect(input.UpdateExpression).toContain('sourceId');
    expect(input.ExpressionAttributeValues[':sourceId']).toBe('src-google-ads');
    expect(input.ExpressionAttributeValues[':phoneNumber']).toBe('+15412830739');
  });

  it('clears the assignment when sourceId is null', async () => {
    const { repo, sent } = makeRepo();
    await repo.put('+15412830739', { sourceId: null }, 'u1');

    const input = sent[0].input;
    expect(input.UpdateExpression).toMatch(/REMOVE .*#sourceId/);
    expect(input.ExpressionAttributeValues?.[':sourceId']).toBeUndefined();
  });

  it('reads one number back', async () => {
    const { repo, sent } = makeRepo([
      { Item: { PK: 'NUMSET#ALL', SK: '+15412830739', phoneNumber: '+15412830739', sourceId: 'src-1' } },
    ]);
    const got = await repo.get('+15412830739');

    expect(sent[0].input.Key).toEqual({ PK: 'NUMSET#ALL', SK: '+15412830739' });
    expect(got).toEqual({ phoneNumber: '+15412830739', sourceId: 'src-1' });
  });

  it('returns null for a number with no settings', async () => {
    const { repo } = makeRepo([{}]);
    expect(await repo.get('+15550000000')).toBeNull();
  });

  it('lists every configured number from the one partition', async () => {
    const { repo, sent } = makeRepo([
      {
        Items: [
          { phoneNumber: '+15412830739', sourceId: 'src-1' },
          { phoneNumber: '+14045551234', sourceId: 'src-2' },
        ],
      },
    ]);
    const all = await repo.list();

    expect(sent[0].input.KeyConditionExpression).toContain('PK');
    expect(sent[0].input.ExpressionAttributeValues[':pk']).toBe('NUMSET#ALL');
    expect(all).toEqual([
      { phoneNumber: '+15412830739', sourceId: 'src-1' },
      { phoneNumber: '+14045551234', sourceId: 'src-2' },
    ]);
  });
});
