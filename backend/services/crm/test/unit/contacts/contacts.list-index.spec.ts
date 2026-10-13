/**
 * The repository keeps GSI2 ContactListIndex (`CONTACTS#ACTIVE`) on every
 * contact write, and the list / count read it once the readiness row
 * (`CONTACTLISTINDEX / STATE`) exists — the Scan stays the path until then.
 */
import { ContactsRepository } from 'src/contacts/contacts.repository';
import { CONTACT_LIST_PK, CONTACT_LIST_STATE_KEY } from 'src/contacts/contact-list-index';
import { CONTACTS_GSI2_NAME } from 'src/common/constants/dynamo.constants';
import { createMockContact, createMockDynamoDbService } from '../mocks';

type Cmd = { constructor: { name: string }; input: any };

function setup(handlers: Partial<Record<string, (input: any) => any>> = {}) {
  const dynamoDb = createMockDynamoDbService();
  const calls: { name: string; input: any }[] = [];
  dynamoDb.client.send.mockImplementation(async (cmd: Cmd) => {
    const name = cmd.constructor.name;
    calls.push({ name, input: cmd.input });
    const handler = handlers[name];
    if (handler) return handler(cmd.input);
    return {};
  });
  const repository = new ContactsRepository(dynamoDb as any);
  return { repository, dynamoDb, calls };
}

const encode = (key: Record<string, unknown>) => Buffer.from(JSON.stringify(key)).toString('base64url');

const stored = (over: Record<string, unknown> = {}) => ({
  ...createMockContact(),
  PK: 'CONTACT#contact-1',
  SK: 'METADATA',
  ...over,
});

describe('ContactsRepository — list index maintenance', () => {
  it('create files an active contact under CONTACTS#ACTIVE by name', async () => {
    const { repository, calls } = setup();
    await repository.create(createMockContact({ firstName: 'Ann', lastName: 'Lee', phones: [] }));
    const put = calls[0].input.TransactItems[0].Put.Item;
    expect(put.GSI2PK).toBe(CONTACT_LIST_PK);
    expect(put.GSI2SK).toBe('ann lee#contact-1');
  });

  it('an update that renames re-files the row with a guarded write', async () => {
    const { repository, calls } = setup({
      UpdateCommand: (input) =>
        input.UpdateExpression.startsWith('SET GSI2PK')
          ? { Attributes: stored({ firstName: 'Johnny', GSI2PK: CONTACT_LIST_PK, GSI2SK: 'johnny doe#contact-1' }) }
          : { Attributes: stored({ firstName: 'Johnny', GSI2PK: CONTACT_LIST_PK, GSI2SK: 'john doe#contact-1' }) },
    });

    const updated = await repository.update('contact-1', { firstName: 'Johnny' });

    expect(updated.firstName).toBe('Johnny');
    const restamp = calls.filter((c) => c.name === 'UpdateCommand')[1];
    expect(restamp.input.UpdateExpression).toBe('SET GSI2PK = :gsi2pk, GSI2SK = :gsi2sk');
    expect(restamp.input.ExpressionAttributeValues[':gsi2sk']).toBe('johnny doe#contact-1');
    expect(restamp.input.ConditionExpression).toContain('#cl_firstName = :cl_firstName');
  });

  it('an update that leaves the keys right writes once', async () => {
    const { repository, calls } = setup({
      UpdateCommand: () => ({ Attributes: stored({ GSI2PK: CONTACT_LIST_PK, GSI2SK: 'john doe#contact-1', notes: 'x' }) }),
    });
    await repository.update('contact-1', { notes: 'x' });
    expect(calls.filter((c) => c.name === 'UpdateCommand')).toHaveLength(1);
  });

  it('a delete (status → deleted) takes the row off the list', async () => {
    const { repository, calls } = setup({
      UpdateCommand: (input) =>
        input.UpdateExpression.startsWith('REMOVE')
          ? { Attributes: stored({ status: 'deleted' }) }
          : { Attributes: stored({ status: 'deleted', GSI2PK: CONTACT_LIST_PK, GSI2SK: 'john doe#contact-1' }) },
    });
    await repository.update('contact-1', { status: 'deleted' } as any);
    const restamp = calls.filter((c) => c.name === 'UpdateCommand')[1];
    expect(restamp.input.UpdateExpression).toBe('REMOVE GSI2PK, GSI2SK');
  });

  it('a lost race re-reads the row consistently and plans again', async () => {
    let restamps = 0;
    const { repository, calls } = setup({
      UpdateCommand: (input) => {
        if (input.UpdateExpression.startsWith('SET GSI2PK')) {
          restamps += 1;
          if (restamps === 1) {
            const err = new Error('cond');
            err.name = 'ConditionalCheckFailedException';
            throw err;
          }
          return { Attributes: stored({ firstName: 'Jim', GSI2PK: CONTACT_LIST_PK, GSI2SK: 'jim doe#contact-1' }) };
        }
        return { Attributes: stored({ firstName: 'Johnny' }) };
      },
      GetCommand: () => ({ Item: stored({ firstName: 'Jim' }) }),
    });

    await repository.update('contact-1', { firstName: 'Johnny' });

    const get = calls.find((c) => c.name === 'GetCommand')!;
    expect(get.input.ConsistentRead).toBe(true);
    const last = calls.filter((c) => c.name === 'UpdateCommand').pop()!;
    expect(last.input.ExpressionAttributeValues[':gsi2sk']).toBe('jim doe#contact-1');
  });
});

describe('ContactsRepository — list and count on the index', () => {
  const ready = { GetCommand: (input: any) => (input.Key.PK === CONTACT_LIST_STATE_KEY.PK ? { Item: { readyAt: 'now' } } : {}) };

  it('Scans while the readiness row does not exist', async () => {
    const { repository, calls } = setup({ ScanCommand: () => ({ Items: [stored()] }) });
    const page = await repository.findActive(20);
    expect(page.items.map((c) => c.id)).toEqual(['contact-1']);
    expect(calls.some((c) => c.name === 'QueryCommand')).toBe(false);
    expect(calls.some((c) => c.name === 'ScanCommand')).toBe(true);
  });

  it('Queries CONTACTS#ACTIVE in name order once ready — one read for an untagged page', async () => {
    const { repository, calls } = setup({
      ...ready,
      QueryCommand: () => ({
        Items: [stored({ GSI2PK: CONTACT_LIST_PK, GSI2SK: 'john doe#contact-1' })],
        LastEvaluatedKey: { PK: 'CONTACT#contact-1', SK: 'METADATA', GSI2PK: CONTACT_LIST_PK, GSI2SK: 'john doe#contact-1' },
      }),
    });

    const page = await repository.findActive(20);

    const queries = calls.filter((c) => c.name === 'QueryCommand');
    expect(queries).toHaveLength(1);
    expect(queries[0].input).toMatchObject({
      IndexName: CONTACTS_GSI2_NAME,
      KeyConditionExpression: 'GSI2PK = :pk',
      ScanIndexForward: true,
      Limit: 20,
    });
    expect(queries[0].input.ExpressionAttributeValues[':pk']).toBe(CONTACT_LIST_PK);
    expect(queries[0].input.FilterExpression).toBeUndefined();
    expect(page.items[0].id).toBe('contact-1');
    expect(JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString())).toMatchObject({ GSI2PK: CONTACT_LIST_PK });
    expect(calls.some((c) => c.name === 'ScanCommand')).toBe(false);
  });

  it('applies the tag filter on the index read and fills the page across reads', async () => {
    let reads = 0;
    const { repository, calls } = setup({
      ...ready,
      QueryCommand: () => {
        reads += 1;
        return reads === 1
          ? { Items: [], LastEvaluatedKey: { PK: 'CONTACT#a', SK: 'METADATA', GSI2PK: CONTACT_LIST_PK, GSI2SK: 'a#a' } }
          : { Items: [stored({ tagIds: ['t1'] })] };
      },
    });

    const page = await repository.findActive(10, undefined, { tagIds: ['t1', 't2'] });

    const queries = calls.filter((c) => c.name === 'QueryCommand');
    expect(queries).toHaveLength(2);
    expect(queries[0].input.FilterExpression).toBe('(contains(#tagIds, :tag0) OR contains(#tagIds, :tag1))');
    expect(queries[1].input.ExclusiveStartKey).toMatchObject({ GSI2SK: 'a#a' });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeUndefined();
  });

  it('a Scan-era cursor keeps Scanning even after the index is ready (a tab open across the switch)', async () => {
    const { repository, calls } = setup({ ...ready, ScanCommand: () => ({ Items: [] }) });
    await repository.findActive(20, encode({ PK: 'CONTACT#x', SK: 'METADATA' }));
    expect(calls.some((c) => c.name === 'ScanCommand')).toBe(true);
    expect(calls.some((c) => c.name === 'QueryCommand')).toBe(false);
  });

  it('an index cursor resumes the index Query', async () => {
    const cursorKey = { PK: 'CONTACT#x', SK: 'METADATA', GSI2PK: CONTACT_LIST_PK, GSI2SK: 'x#x' };
    const { repository, calls } = setup({ ...ready, QueryCommand: () => ({ Items: [] }) });
    await repository.findActive(20, encode(cursorKey));
    expect(calls.find((c) => c.name === 'QueryCommand')!.input.ExclusiveStartKey).toEqual(cursorKey);
  });

  it('falls back to the Scan when the readiness row exists but the index does not', async () => {
    const { repository, calls } = setup({
      ...ready,
      QueryCommand: () => {
        const err = new Error('The table does not have the specified index: ContactListIndex');
        err.name = 'ValidationException';
        throw err;
      },
      ScanCommand: () => ({ Items: [stored()] }),
    });
    const page = await repository.findActive(20);
    expect(page.items).toHaveLength(1);
    expect(calls.some((c) => c.name === 'ScanCommand')).toBe(true);
  });

  it('counts the index partition without bodies once ready', async () => {
    const { repository, calls } = setup({ ...ready, QueryCommand: () => ({ Count: 7 }) });
    const count = await repository.countActive({ tagIds: ['t1'] });
    expect(count).toEqual({ total: 7, atLeast: false });
    const q = calls.find((c) => c.name === 'QueryCommand')!.input;
    expect(q).toMatchObject({ IndexName: CONTACTS_GSI2_NAME, Select: 'COUNT' });
    expect(q.FilterExpression).toBe('(contains(#tagIds, :tag0))');
    expect(calls.some((c) => c.name === 'ScanCommand')).toBe(false);
  });

  it('counts with the Scan until ready', async () => {
    const { repository, calls } = setup({ ScanCommand: () => ({ Count: 3 }) });
    expect(await repository.countActive()).toEqual({ total: 3, atLeast: false });
    expect(calls.some((c) => c.name === 'QueryCommand')).toBe(false);
  });

  it('asks about readiness at most once a minute while not ready, and never again once ready', async () => {
    const { repository, calls } = setup({ ScanCommand: () => ({ Items: [] }) });
    await repository.listIndexReady(1_000);
    await repository.listIndexReady(30_000);
    expect(calls.filter((c) => c.name === 'GetCommand')).toHaveLength(1);
    await repository.listIndexReady(62_000);
    expect(calls.filter((c) => c.name === 'GetCommand')).toHaveLength(2);

    const r = setup(ready);
    expect(await r.repository.listIndexReady(1_000)).toBe(true);
    expect(await r.repository.listIndexReady(10_000_000)).toBe(true);
    expect(r.calls.filter((c) => c.name === 'GetCommand')).toHaveLength(1);
  });
});
