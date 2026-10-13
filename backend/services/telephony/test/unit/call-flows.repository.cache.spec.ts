import { DynamoDbService } from '@bitcrm/shared';
import { CallFlowsRepository } from '../../src/call-flows/call-flows.repository';

/**
 * The flows list is read by `GET /call-flows`, by every inbound call (which
 * flow answers this number) and by every call-record write (the company of
 * the flow answering the number). Cached in process for 30 s, single-flight,
 * dropped by this task's own create / put / delete.
 */

function makeRepo() {
  const flows = [{ id: 'f1', name: 'Main', numbers: ['+15550000001'], active: true, nodes: {} }];
  const sent: Array<{ input: Record<string, any>; constructor: { name: string } }> = [];
  const client = {
    send: jest.fn(async (cmd: any) => {
      sent.push(cmd);
      return cmd.constructor.name === 'QueryCommand' ? { Items: structuredClone(flows) } : {};
    }),
  };
  const repo = new CallFlowsRepository({ client } as unknown as DynamoDbService);
  const queries = () => sent.filter((c) => c.constructor.name === 'QueryCommand').length;
  return { repo, queries };
}

describe('CallFlowsRepository — listAll cache', () => {
  it('queries once within 30 s, single-flight', async () => {
    const { repo, queries } = makeRepo();
    await Promise.all([repo.listAll(), repo.listAll()]);
    await repo.listAll();
    expect(queries()).toBe(1);
  });

  it.each([
    ['create', (r: CallFlowsRepository) => r.create({ id: 'f2', name: 'B' } as never)],
    ['put', (r: CallFlowsRepository) => r.put({ id: 'f1', name: 'Main' } as never)],
    ['delete', (r: CallFlowsRepository) => r.delete('f1')],
  ])('%s drops the cache', async (_name, write) => {
    const { repo, queries } = makeRepo();
    await repo.listAll();
    await write(repo);
    await repo.listAll();
    expect(queries()).toBe(2);
  });

  it('reloads after 30 s', async () => {
    jest.useFakeTimers({ now: 0 });
    try {
      const { repo, queries } = makeRepo();
      await repo.listAll();
      jest.setSystemTime(30_001);
      await repo.listAll();
      expect(queries()).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a caller sorting or editing its copy never changes the cache', async () => {
    const { repo } = makeRepo();
    const first = await repo.listAll();
    first[0].name = 'tampered';
    first.length = 0;
    const again = await repo.listAll();
    expect(again).toHaveLength(1);
    expect(again[0].name).toBe('Main');
  });
});
