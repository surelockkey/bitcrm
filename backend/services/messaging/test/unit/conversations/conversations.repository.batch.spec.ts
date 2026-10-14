import { DynamoDbService } from '@bitcrm/shared';
import { ConversationsRepository } from '../../../src/conversations/conversations.repository';
import { conversationItem } from '../../../src/conversations/conversation-keys';
import { createMockConversation } from '../mocks';

/** A document client answering BatchGet from an in-memory table; `unprocessed` keys are held back once. */
function table(items: Array<Record<string, unknown>>, opts: { holdBackOnce?: string[] } = {}) {
  const byKey = new Map(items.map((i) => [`${i.PK}|${i.SK}`, i]));
  const held = new Set(opts.holdBackOnce ?? []);
  const requests: Array<Array<{ PK: string; SK: string }>> = [];
  const send = jest.fn(async (cmd: { constructor: { name: string }; input: any }) => {
    expect(cmd.constructor.name).toBe('BatchGetCommand');
    const [tableName] = Object.keys(cmd.input.RequestItems);
    const keys = cmd.input.RequestItems[tableName].Keys as Array<{ PK: string; SK: string }>;
    requests.push(keys);
    const back = keys.filter((k) => held.delete(k.PK));
    const answered = keys.filter((k) => !back.includes(k));
    return {
      Responses: { [tableName]: answered.map((k) => byKey.get(`${k.PK}|${k.SK}`)).filter(Boolean) },
      ...(back.length && { UnprocessedKeys: { [tableName]: { Keys: back } } }),
    };
  });
  const repo = new ConversationsRepository({ client: { send } } as unknown as DynamoDbService);
  return { repo, send, requests };
}

const pointer = (kind: string, id: string, conversationId: string) => ({
  PK: `CONVOF#${kind}#${id}`,
  SK: 'METADATA',
  pointerKind: kind,
  pointerId: id,
  conversationId,
  createdAt: '2026-09-01T00:00:00.000Z',
});

describe('ConversationsRepository.getManyByParty', () => {
  it('two BatchGets — pointers, then the conversations they name — keyed <kind>:<id>', async () => {
    const c1 = createMockConversation({ id: 'c1', partyId: 'ct1' });
    const g1 = createMockConversation({ id: 'g1', kind: 'group', partyKind: 'group', partyId: 'g1' });
    const { repo, requests } = table([
      pointer('contact', 'ct1', 'c1'),
      pointer('group', 'g1', 'g1'),
      pointer('company', 'co1', 'gone'), // dangling: no conversation row
      conversationItem(c1),
      conversationItem(g1),
    ]);
    const found = await repo.getManyByParty([
      { kind: 'contact', id: 'ct1' },
      { kind: 'contact', id: 'nobody' },
      { kind: 'company', id: 'co1' },
      { kind: 'group', id: 'g1' },
    ]);
    expect([...found.keys()]).toEqual(['contact:ct1', 'group:g1']);
    expect(found.get('contact:ct1')).toEqual(c1);
    expect(requests).toHaveLength(2);
    expect(requests[0].map((k) => k.PK)).toEqual(['CONVOF#contact#ct1', 'CONVOF#contact#nobody', 'CONVOF#company#co1', 'CONVOF#group#g1']);
    expect(requests[1].map((k) => k.PK).sort()).toEqual(['CONV#c1', 'CONV#g1', 'CONV#gone']);
  });

  it('100 keys a request, side by side; duplicates asked once', async () => {
    const parties = Array.from({ length: 230 }, (_, i) => ({ kind: 'contact' as const, id: `ct${i}` }));
    const { repo, requests } = table(parties.map((p) => pointer('contact', p.id, `c-${p.id}`)));
    await repo.getManyByParty([...parties, parties[0]]);
    expect(requests.slice(0, 3).map((r) => r.length)).toEqual([100, 100, 30]);
  });

  it('asks again for what DynamoDB left unprocessed', async () => {
    const c1 = createMockConversation({ id: 'c1', partyId: 'ct1' });
    const { repo } = table([pointer('contact', 'ct1', 'c1'), conversationItem(c1)], {
      holdBackOnce: ['CONVOF#contact#ct1', 'CONV#c1'],
    });
    const found = await repo.getManyByParty([{ kind: 'contact', id: 'ct1' }]);
    expect(found.get('contact:ct1')?.id).toBe('c1');
  });

  it('no parties, no request', async () => {
    const { repo, send } = table([]);
    expect((await repo.getManyByParty([])).size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
