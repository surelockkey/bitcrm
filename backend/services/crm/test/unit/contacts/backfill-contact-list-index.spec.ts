/**
 * `backfill:contact-list-index` reconciles GSI2 ContactListIndex on every
 * contact METADATA row (sets missing / stale keys, removes keys a row no
 * longer qualifies for) and, on `--apply` only, stamps the readiness row the
 * list waits for.
 */
import { reconcileContactList } from 'src/scripts/backfill-contact-list-index';
import { CONTACT_LIST_PK, CONTACT_LIST_STATE_KEY } from 'src/contacts/contact-list-index';

const contact = (id: string, over: Record<string, unknown> = {}) => ({
  PK: `CONTACT#${id}`,
  SK: 'METADATA',
  id,
  firstName: 'A',
  lastName: id,
  status: 'active',
  ...over,
});

function fakeSend(pages: Record<string, unknown>[][], failFor: string[] = []) {
  const calls: { name: string; input: any }[] = [];
  let page = 0;
  const send = jest.fn(async (cmd: any) => {
    const name = cmd.constructor.name;
    calls.push({ name, input: cmd.input });
    if (name === 'ScanCommand') {
      const i = page++;
      return { Items: pages[i] ?? [], ...(i + 1 < pages.length && { LastEvaluatedKey: { PK: `p${i}`, SK: 'x' } }) };
    }
    if (name === 'UpdateCommand' && failFor.includes(cmd.input.Key.PK)) {
      const err = new Error('changed');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }
    return {};
  });
  return { send, calls };
}

describe('reconcileContactList', () => {
  const rows = () => [
    [
      contact('1'), // to file
      contact('2', { GSI2PK: CONTACT_LIST_PK, GSI2SK: 'a 2#2' }), // already right
      contact('3', { status: 'deleted', GSI2PK: CONTACT_LIST_PK, GSI2SK: 'a 3#3' }), // to remove
    ],
    [contact('4', { GSI2PK: CONTACT_LIST_PK, GSI2SK: 'old#4' })], // stale name → re-file
  ];

  it('a dry run counts what it would do, writes nothing and never stamps readiness', async () => {
    const { send, calls } = fakeSend(rows());
    const r = await reconcileContactList(send, { table: 'T', apply: false, log: () => undefined });
    expect(r).toMatchObject({ scanned: 4, same: 1, set: 2, removed: 1, skipped: 0, qualifying: 3 });
    expect(calls.filter((c) => c.name !== 'ScanCommand')).toHaveLength(0);
    expect(r.readyAt).toBeUndefined();
  });

  it('--apply files, re-files and removes with guarded writes, then stamps CONTACTLISTINDEX / STATE', async () => {
    const { send, calls } = fakeSend(rows());
    const r = await reconcileContactList(send, { table: 'T', apply: true, log: () => undefined });

    expect(r).toMatchObject({ scanned: 4, set: 2, removed: 1, same: 1, skipped: 0, qualifying: 3 });
    const updates = calls.filter((c) => c.name === 'UpdateCommand');
    expect(updates.map((u) => u.input.Key.PK).sort()).toEqual(['CONTACT#1', 'CONTACT#3', 'CONTACT#4']);
    expect(updates.every((u) => u.input.ConditionExpression.includes('attribute_exists(PK)'))).toBe(true);
    const put = calls.find((c) => c.name === 'PutCommand')!;
    expect(put.input.Item).toMatchObject({ ...CONTACT_LIST_STATE_KEY, count: 3 });
    expect(typeof put.input.Item.readyAt).toBe('string');
    // Only contact METADATA rows are read.
    const scan = calls.find((c) => c.name === 'ScanCommand')!.input;
    expect(scan.FilterExpression).toBe('SK = :meta AND begins_with(PK, :contact)');
  });

  it('a row edited during the run is skipped — its own write re-filed it', async () => {
    const { send } = fakeSend(rows(), ['CONTACT#1']);
    const r = await reconcileContactList(send, { table: 'T', apply: true, log: () => undefined });
    expect(r.skipped).toBe(1);
    expect(r.set).toBe(1);
  });

  it('a failure stops the run before the readiness stamp', async () => {
    const send = jest.fn(async (cmd: any) => {
      if (cmd.constructor.name === 'ScanCommand') throw new Error('throttled');
      return {};
    });
    await expect(reconcileContactList(send, { table: 'T', apply: true, log: () => undefined })).rejects.toThrow('throttled');
    expect(send.mock.calls.some(([c]: any[]) => c.constructor.name === 'PutCommand')).toBe(false);
  });
});
