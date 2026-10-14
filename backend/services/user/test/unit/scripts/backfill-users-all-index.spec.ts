import { reconcileUsersAllIndex } from '../../../src/scripts/backfill-users-all-index';

/**
 * backfill:users-all-index — a derived projection, so it RECONCILES: the
 * all-users keys set on every user METADATA row that lacks them (or holds
 * wrong ones), removed from any other row that carries them. Dry run unless
 * asked to apply; the state row only on a complete apply.
 */
describe('backfill:users-all-index', () => {
  function fakeClient(pages: Record<string, unknown>[][], failFor: string[] = []) {
    const updates: any[] = [];
    const puts: any[] = [];
    let page = 0;
    const send = jest.fn(async (cmd: any) => {
      const name = cmd.constructor.name;
      if (name === 'ScanCommand') {
        const items = pages[page] ?? [];
        page += 1;
        return { Items: items, ...(page < pages.length && { LastEvaluatedKey: { page } }) };
      }
      if (name === 'UpdateCommand') {
        if (failFor.includes(cmd.input.Key.PK)) {
          throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
        }
        updates.push(cmd.input);
        return {};
      }
      if (name === 'PutCommand') {
        puts.push(cmd.input);
        return {};
      }
      throw new Error(`unexpected ${name}`);
    });
    return { send, updates, puts };
  }

  const user = (id: string, over: Record<string, unknown> = {}) => ({ PK: `USER#${id}`, SK: 'METADATA', id, ...over });
  const rows = () => [
    [
      user('a'), // needs keys
      user('b', { GSI3PK: 'USERS#ALL', GSI3SK: 'USER#b' }), // correct
      user('c', { GSI3PK: 'USERS#ALL', GSI3SK: 'USER#zzz' }), // wrong sort key
    ],
    [
      { PK: 'USER#a', SK: 'TECH_PROFILE', GSI3PK: 'TECHNICIAN', GSI3SK: 'pending#a' }, // a technician row — not ours
      { PK: 'USER#a', SK: 'JOBTYPE#jt', GSI3PK: 'USERS#ALL', GSI3SK: 'USER#a' }, // wrongly keyed — remove
      { PK: 'PHONE#+1404', SK: 'USER' },
    ],
  ];

  it('a dry run counts what it would do and writes nothing', async () => {
    const { send, updates, puts } = fakeClient(rows());
    const out = await reconcileUsersAllIndex(send as any, { table: 'T', apply: false, log: () => undefined });
    expect(out).toEqual({ scanned: 6, users: 3, same: 1, set: 2, removed: 1, skipped: 0 });
    expect(updates).toHaveLength(0);
    expect(puts).toHaveLength(0);
  });

  it('--apply sets and removes keys, guarded on the row still being there, then stamps', async () => {
    const { send, updates, puts } = fakeClient(rows());
    const out = await reconcileUsersAllIndex(send as any, { table: 'T', apply: true, log: () => undefined });
    expect(out).toEqual(expect.objectContaining({ set: 2, removed: 1, skipped: 0, users: 3 }));

    const setA = updates.find((u) => u.Key.PK === 'USER#a' && u.Key.SK === 'METADATA');
    expect(setA.UpdateExpression).toBe('SET GSI3PK = :pk, GSI3SK = :sk');
    expect(setA.ExpressionAttributeValues).toEqual({ ':pk': 'USERS#ALL', ':sk': 'USER#a' });
    expect(setA.ConditionExpression).toBe('attribute_exists(PK)');

    const removed = updates.find((u) => u.Key.SK === 'JOBTYPE#jt');
    expect(removed.UpdateExpression).toBe('REMOVE GSI3PK, GSI3SK');
    expect(removed.ConditionExpression).toBe('GSI3PK = :pk');

    // Never touches the technician index's own rows.
    expect(updates.some((u) => u.Key.SK === 'TECH_PROFILE')).toBe(false);

    expect(puts).toHaveLength(1);
    expect(puts[0].Item).toEqual(expect.objectContaining({ PK: 'USERSALLINDEX', SK: 'STATE', count: 3 }));
    expect(typeof out.readyAt).toBe('string');
  });

  it('counts a row deleted mid-run as skipped, and still stamps', async () => {
    const { send, puts } = fakeClient(rows(), ['USER#a']);
    const out = await reconcileUsersAllIndex(send as any, { table: 'T', apply: true, log: () => undefined });
    expect(out.skipped).toBe(2); // USER#a METADATA and USER#a JOBTYPE#jt
    expect(puts).toHaveLength(1);
  });

  it('a run that throws stamps nothing', async () => {
    const send = jest.fn(async () => {
      throw new Error('throttled');
    });
    await expect(
      reconcileUsersAllIndex(send as any, { table: 'T', apply: true, log: () => undefined }),
    ).rejects.toThrow('throttled');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
