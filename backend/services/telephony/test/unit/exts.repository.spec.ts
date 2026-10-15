import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ExtsRepository } from '../../src/exts/exts.repository';

/**
 * The reverse pointers, one per (job, phone position).
 *
 * The first number's pointer stays exactly where it always was —
 * `EXTOF#<dealId> / METADATA` — so every code minted before codes were per
 * number keeps resolving with no migration. The other numbers sit beside it
 * in the same partition (`PHONE#<i>`), which is what lets one Query find every
 * code a job holds when it closes.
 */
function make(items: Record<string, Record<string, unknown>> = {}) {
  const sent: unknown[] = [];
  const send = jest.fn(async (cmd: unknown) => {
    sent.push(cmd);
    if (cmd instanceof GetCommand) {
      const key = cmd.input.Key as { PK: string; SK: string };
      return { Item: items[`${key.PK}|${key.SK}`] };
    }
    if (cmd instanceof QueryCommand) {
      const pk = (cmd.input.ExpressionAttributeValues as Record<string, string>)[':pk'];
      return {
        Items: Object.entries(items)
          .filter(([k]) => k.startsWith(`${pk}|`))
          .map(([, v]) => v),
      };
    }
    return {};
  });
  const repo = new ExtsRepository({ client: { send } } as never);
  return { repo, send, sent };
}

describe('ExtsRepository — per-number pointers', () => {
  it('keeps the first number on the original pointer row', async () => {
    const { repo, sent } = make();

    await repo.claim('4729', 'deal-1');

    const pointer = sent.find(
      (c) => c instanceof PutCommand && (c.input.Item as { PK: string }).PK === 'EXTOF#deal-1',
    ) as PutCommand;
    expect(pointer.input.Item).toMatchObject({ SK: 'METADATA', code: '4729' });
  });

  it('files every other number beside it, by position', async () => {
    const { repo, sent } = make();

    const ext = await repo.claim('5813', 'deal-1', 2);

    expect(ext).toMatchObject({ code: '5813', dealId: 'deal-1', phoneIndex: 2 });
    const code = sent.find(
      (c) => c instanceof PutCommand && (c.input.Item as { PK: string }).PK === 'EXT#5813',
    ) as PutCommand;
    expect(code.input.Item).toMatchObject({ phoneIndex: 2 });
    const pointer = sent.find(
      (c) => c instanceof PutCommand && (c.input.Item as { PK: string }).PK === 'EXTOF#deal-1',
    ) as PutCommand;
    expect(pointer.input.Item).toMatchObject({ SK: 'PHONE#2', code: '5813', phoneIndex: 2 });
  });

  it('finds a number’s code through its own pointer', async () => {
    const { repo } = make({
      'EXTOF#deal-1|PHONE#1': { code: '6100' },
      'EXT#6100|METADATA': { code: '6100', dealId: 'deal-1', phoneIndex: 1, status: 'active' },
    });

    await expect(repo.findByDeal('deal-1', 1)).resolves.toMatchObject({ code: '6100' });
    await expect(repo.findByDeal('deal-1', 0)).resolves.toBeNull();
  });

  it('still finds a code minted before positions existed', async () => {
    const { repo } = make({
      'EXTOF#deal-1|METADATA': { code: '4729' },
      'EXT#4729|METADATA': { code: '4729', dealId: 'deal-1', status: 'active' },
    });

    await expect(repo.findByDeal('deal-1')).resolves.toMatchObject({ code: '4729' });
  });

  it('lists every code a job holds in one Query', async () => {
    const { repo, sent } = make({
      'EXTOF#deal-1|METADATA': { code: '4729' },
      'EXTOF#deal-1|PHONE#1': { code: '6100' },
      'EXT#4729|METADATA': { code: '4729', dealId: 'deal-1', status: 'active' },
      'EXT#6100|METADATA': { code: '6100', dealId: 'deal-1', phoneIndex: 1, status: 'active' },
    });

    const all = await repo.listByDeal('deal-1');

    expect(all.map((e) => e.code).sort()).toEqual(['4729', '6100']);
    expect(sent.filter((c) => c instanceof QueryCommand)).toHaveLength(1);
  });
});
