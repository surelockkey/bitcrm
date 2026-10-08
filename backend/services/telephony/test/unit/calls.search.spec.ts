import { DynamoDbService } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import {
  foldSearchText,
  parseCallSearch,
  partyNamesText,
} from '../../src/calls/call-search';
import { CallsRepository, type CallRecord } from '../../src/calls/calls.repository';
import { CallsController } from '../../src/calls/calls.controller';
import { type CallsService } from '../../src/calls/calls.service';
import { callsFilterFromQuery } from '../../src/calls/call-query';

/**
 * Пошук у журналі дзвінків, як у Workiz: ім'я того, хто дзвонив або кому
 * дзвонили, і цифри номера. Імена на рядку дзвінка не зберігались — лише id
 * сторін, — тож рядок отримує `partyNames`: складені (нижній регістр, без
 * діакритики) імена обох сторін. Пише їх читання журналу, коли імена відомі
 * і відрізняються від збережених (новий дзвінок, перейменований клієнт), і
 * скрипт backfill:call-party-names для решти.
 */

describe('foldSearchText', () => {
  it('lower case, accents off, one space, trimmed', () => {
    expect(foldSearchText('  José   ÁLVAREZ ')).toBe('jose alvarez');
    expect(foldSearchText(undefined)).toBe('');
  });
});

describe('partyNamesText', () => {
  it('folds both sides, once each, newline apart — the box never sends a newline', () => {
    expect(partyNamesText(['Jane Roe', '(1) (Hanna) 14 Dispatcher', 'jane roe'])).toBe('jane roe\n(1) (hanna) 14 dispatcher');
  });

  it('nothing named → empty', () => {
    expect(partyNamesText([undefined, '  '])).toBe('');
  });
});

describe('parseCallSearch', () => {
  it('nothing typed → no search', () => {
    expect(parseCallSearch('   ', { numbers: true })).toBeUndefined();
    expect(parseCallSearch(undefined, { numbers: true })).toBeUndefined();
  });

  it('a name is folded text', () => {
    expect(parseCallSearch('Jané', { numbers: true })).toEqual({ text: 'jane' });
  });

  it('a phone-shaped entry also matches by its digits', () => {
    expect(parseCallSearch('(860) 841', { numbers: true })).toEqual({ text: '(860) 841', digits: '860841' });
    // Workiz's search 860 (callspage_wz_12_search_860) — three digits are an area code.
    expect(parseCallSearch('860', { numbers: true })).toEqual({ text: '860', digits: '860' });
  });

  it('two digits are too few to be a number', () => {
    expect(parseCallSearch('86', { numbers: true })).toEqual({ text: '86' });
  });

  it('never matches by digits for a viewer whose numbers are masked', () => {
    expect(parseCallSearch('(860) 841', { numbers: false })).toEqual({ text: '(860) 841' });
  });

  it('a paste is cut to a sane length', () => {
    expect(parseCallSearch('x'.repeat(500), { numbers: true })!.text).toHaveLength(100);
  });
});

describe('the q param', () => {
  it('becomes the filter’s search, gated on the numbers grant', () => {
    expect(callsFilterFromQuery({ q: 'Roe' }, { numbers: true }).search).toEqual({ text: 'roe' });
    expect(callsFilterFromQuery({ q: '203 555' }, { numbers: false }).search).toEqual({ text: '203 555' });
    expect(callsFilterFromQuery({ q: '' }, { numbers: true })).not.toHaveProperty('search');
  });
});

type SentCommand = { input: Record<string, any> };
function makeRepo() {
  const sent: SentCommand[] = [];
  const client = {
    send: jest.fn(async (cmd: SentCommand) => {
      sent.push(cmd);
      return { Items: [] };
    }),
  };
  return { repo: new CallsRepository({ client } as unknown as DynamoDbService), sent, client };
}

describe('CallsRepository — search', () => {
  it('a name matches the folded names of either side', async () => {
    const { repo, sent } = makeRepo();
    await repo.list({ search: { text: 'roe' } }, undefined, 25);

    const input = sent[0].input;
    expect(input.FilterExpression).toContain('contains(#partyNames, :qText)');
    expect(input.ExpressionAttributeNames['#partyNames']).toBe('partyNames');
    expect(input.ExpressionAttributeValues[':qText']).toBe('roe');
    expect(input.FilterExpression).not.toContain(':qDigits');
  });

  it('digits match either number as well, in one OR', async () => {
    const { repo, sent } = makeRepo();
    await repo.list({ search: { text: '860', digits: '860' } }, undefined, 25);

    expect(sent[0].input.FilterExpression).toContain(
      '(contains(#partyNames, :qText) OR contains(#from, :qDigits) OR contains(#to, :qDigits))',
    );
  });

  it('the count and the cards search the same way', async () => {
    const { repo, sent } = makeRepo();
    await repo.count({ search: { text: 'roe' } });

    expect(sent[0].input.FilterExpression).toContain('contains(#partyNames, :qText)');
  });

  it('stamps the names on an existing row only', async () => {
    const { repo, sent } = makeRepo();
    await repo.setPartyNames('CA1', 'jane roe');

    const input = sent[0].input;
    expect(input.Key).toEqual({ PK: 'CALL#CA1', SK: 'METADATA' });
    expect(input.UpdateExpression).toBe('SET #partyNames = :names');
    expect(input.ExpressionAttributeValues[':names']).toBe('jane roe');
    expect(input.ConditionExpression).toBe('attribute_exists(PK)');
  });

  it('nothing to name removes the attribute rather than storing ""', async () => {
    const { repo, sent } = makeRepo();
    await repo.setPartyNames('CA1', '');

    expect(sent[0].input.UpdateExpression).toBe('REMOVE #partyNames');
  });

  it('a row that is gone is not an error', async () => {
    const { repo, client } = makeRepo();
    client.send.mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'ConditionalCheckFailedException' }));

    await expect(repo.setPartyNames('CAgone', 'x')).resolves.toBeUndefined();
  });
});

describe('CallsController — names written back for the search', () => {
  const ended = (over: Partial<CallRecord> = {}): CallRecord => ({
    callSid: 'CA1',
    direction: 'inbound',
    status: 'completed',
    from: '+14045551234',
    to: '+15412830739',
    answeredAt: '2026-08-05T10:00:05.000Z',
    participants: [{ userId: 'u9', role: 'answered', at: '2026-08-05T10:00:05.000Z' }],
    startedAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T10:01:00.000Z',
    ...over,
  });

  function make(rows: CallRecord[], opts: { users?: Record<string, unknown>; contacts?: Record<string, unknown> } = {}) {
    const calls = {
      list: jest.fn().mockResolvedValue({ items: rows }),
      freezeParties: jest.fn().mockResolvedValue(undefined),
      stampPartyNames: jest.fn().mockResolvedValue(undefined),
    } as unknown as CallsService;
    const userNames = {
      resolve: jest.fn().mockResolvedValue(opts.users ?? { u9: { name: 'Tamir Levi', roleId: 'r-disp' } }),
    };
    const contacts = {
      resolve: jest.fn().mockResolvedValue(opts.contacts ?? { '+14045551234': { kind: 'contact', id: 'c1', name: 'Jane Roe' } }),
      resolveRefs: jest.fn().mockResolvedValue({}),
    };
    const userPhones = { resolve: jest.fn().mockResolvedValue({}) };
    const permissions = { maySeeClientNumbers: jest.fn().mockResolvedValue(true) };
    const none = {} as never;
    const controller = new CallsController(
      calls,
      none,
      none,
      userNames as never,
      contacts as never,
      userPhones as never,
      none,
      permissions as never,
      none,
      none,
      {} as never,
    );
    return { controller, calls };
  }

  const flush = () => new Promise((r) => setImmediate(r));

  it('stamps both sides’ names on an ended call that has none', async () => {
    const { controller, calls } = make([ended()]);

    await controller.list({}, { id: 'x' } as JwtUser);
    await flush();

    expect(calls.stampPartyNames).toHaveBeenCalledWith('CA1', 'jane roe\ntamir levi');
  });

  it('leaves a row whose names are already right alone', async () => {
    const { controller, calls } = make([ended({ partyNames: 'jane roe\ntamir levi' })]);

    await controller.list({}, { id: 'x' } as JwtUser);
    await flush();

    expect(calls.stampPartyNames).not.toHaveBeenCalled();
  });

  it('restamps a renamed client', async () => {
    const { controller, calls } = make([ended({ partyNames: 'jane smith\ntamir levi' })]);

    await controller.list({}, { id: 'x' } as JwtUser);
    await flush();

    expect(calls.stampPartyNames).toHaveBeenCalledWith('CA1', 'jane roe\ntamir levi');
  });

  it('never stamps from a half-answered lookup — a user-service blip is not a rename', async () => {
    const { controller, calls } = make([ended({ partyNames: 'jane roe\ntamir levi' })], { users: {} });

    await controller.list({}, { id: 'x' } as JwtUser);
    await flush();

    expect(calls.stampPartyNames).not.toHaveBeenCalled();
  });

  it('never stamps a call that is still going', async () => {
    const { controller, calls } = make([ended({ status: 'in-progress', partyNames: undefined })]);

    await controller.list({}, { id: 'x' } as JwtUser);
    await flush();

    expect(calls.stampPartyNames).not.toHaveBeenCalled();
  });

  it('a stranger’s number names nobody — nothing to stamp', async () => {
    const { controller, calls } = make([ended({ participants: undefined })], { contacts: {} });

    await controller.list({}, { id: 'x' } as JwtUser);
    await flush();

    expect(calls.stampPartyNames).not.toHaveBeenCalled();
  });

  it('the stored names never reach the response', async () => {
    const { controller } = make([ended({ partyNames: 'jane roe\ntamir levi' })]);

    const res = await controller.list({}, { id: 'x' } as JwtUser);

    expect(res.data[0]).not.toHaveProperty('partyNames');
  });

  it('hands q to the service as a folded search', async () => {
    const { controller, calls } = make([]);

    await controller.list({ q: ' Jané ' }, { id: 'x' } as JwtUser);

    expect((calls.list as jest.Mock).mock.calls[0][0]).toEqual({ search: { text: 'jane' } });
  });
});
