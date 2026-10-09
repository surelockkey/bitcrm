import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CallFlowsService } from 'src/call-flows/call-flows.service';
import type { CallFlow, CallFlowNode } from '@bitcrm/types';

/**
 * A Forward step rings a group, a user, a device or an external number
 * (Workiz's Forward Calls pane), and says how long before the call moves on.
 * Flows stored with the old `groupId` alone keep saving and loading as they
 * are — the target shape is read through `ringTargetOf`, never migrated.
 */
function build(seed: CallFlow[] = []) {
  const store = new Map(seed.map((f) => [f.id, structuredClone(f)]));
  const repository = {
    listAll: jest.fn(async () => [...store.values()]),
    get: jest.fn(async (id: string) => store.get(id) ?? null),
    create: jest.fn(async (f: CallFlow) => void store.set(f.id, f)),
    put: jest.fn(async (f: CallFlow) => void store.set(f.id, f)),
    delete: jest.fn(async (id: string) => void store.delete(id)),
  };
  const groups = {
    findById: jest.fn(async (id: string) => {
      if (id !== 'g1') throw new NotFoundException(`Call group ${id} not found`);
      return { id, name: 'Dispatch' };
    }),
  };
  const directory = {
    find: jest.fn(async (id: string) => (id === 'u-riley' ? { id, name: 'Riley CSR' } : undefined)),
  };
  const devices = {
    findRaw: jest.fn(async (id: string) => (id === 'd-ct' ? { id, name: 'SURE CT LOCKSMITH', number: '+12039893585', active: true } : null)),
  };
  const service = new CallFlowsService(repository as never, groups as never, directory as never, devices as never);
  return { service, store, groups, directory, devices };
}

const caller = { id: 'u-admin' };

const ring = (over: Record<string, unknown>): CallFlowNode => ({ id: 'ring', type: 'ring', ...over }) as CallFlowNode;
// Names are unique per flow, so a test may save several without a 409.
let lines = 0;
const flowWith = (node: CallFlowNode) => ({ name: `Line ${++lines}`, numbers: [], entryNodeId: 'ring', nodes: { ring: node } });

describe('CallFlowsService — Forward targets', () => {
  it('still saves the old shape: a ring with a groupId alone', async () => {
    const { service, groups, store } = build();
    const flow = await service.create(flowWith(ring({ groupId: 'g1' })), caller);
    expect(groups.findById).toHaveBeenCalledWith('g1');
    expect(store.get(flow.id)!.nodes.ring).toMatchObject({ groupId: 'g1' });
  });

  it('checks a group target exists, as it did for groupId', async () => {
    const { service } = build();
    await expect(service.create(flowWith(ring({ target: { kind: 'group', id: 'g1' } })), caller)).resolves.toBeDefined();
    await expect(service.create(flowWith(ring({ target: { kind: 'group', id: 'g-gone' } })), caller)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('checks a user target is somebody in the directory', async () => {
    const { service } = build();
    await expect(service.create(flowWith(ring({ target: { kind: 'user', id: 'u-riley' } })), caller)).resolves.toBeDefined();
    await expect(service.create(flowWith(ring({ target: { kind: 'user', id: 'u-nobody' } })), caller)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('checks a device target is in the catalog', async () => {
    const { service } = build();
    await expect(service.create(flowWith(ring({ target: { kind: 'device', id: 'd-ct' } })), caller)).resolves.toBeDefined();
    await expect(service.create(flowWith(ring({ target: { kind: 'device', id: 'd-gone' } })), caller)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores an external number in E.164 and refuses one that is not a number', async () => {
    const { service, store } = build();
    const flow = await service.create(flowWith(ring({ target: { kind: 'external', number: '(203) 883-6913' } })), caller);
    expect(store.get(flow.id)!.nodes.ring).toMatchObject({ target: { kind: 'external', number: '+12038836913' } });
    await expect(service.create(flowWith(ring({ target: { kind: 'external', number: '12' } })), caller)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a ring step with nowhere to ring', async () => {
    const { service } = build();
    await expect(service.create(flowWith(ring({})), caller)).rejects.toThrow(/somewhere to ring/);
    await expect(service.create(flowWith(ring({ target: { kind: 'group', id: '' } })), caller)).rejects.toThrow(/somewhere to ring/);
  });

  it('keeps "move to next step after N sec" between 5 and 600', async () => {
    const { service, store } = build();
    const ok = await service.create(flowWith(ring({ groupId: 'g1', timeoutSec: 300 })), caller);
    expect(store.get(ok.id)!.nodes.ring).toMatchObject({ timeoutSec: 300 });
    await expect(service.create(flowWith(ring({ groupId: 'g1', timeoutSec: 4 })), caller)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(flowWith(ring({ groupId: 'g1', timeoutSec: 601 })), caller)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(flowWith(ring({ groupId: 'g1', timeoutSec: 'soon' })), caller)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a flow that is not in the editor any more still updates: an old ring keeps its groupId', async () => {
    const { service, store } = build();
    const flow = await service.create(flowWith(ring({ groupId: 'g1' })), caller);
    const renamed = await service.update(flow.id, { name: 'Renamed' }, caller);
    expect(renamed.nodes.ring).toMatchObject({ groupId: 'g1' });
    expect(store.get(flow.id)!.nodes.ring).not.toHaveProperty('target');
  });

  describe('Record Call Flow', () => {
    it('is unset on create unless sent, so an old flow and a new one record alike', async () => {
      const { service } = build();
      const flow = await service.create(flowWith(ring({ groupId: 'g1' })), caller);
      expect(flow).not.toHaveProperty('record');
      const quiet = await service.create({ ...flowWith(ring({ groupId: 'g1' })), name: 'Quiet', record: false }, caller);
      expect(quiet.record).toBe(false);
    });

    it('is switched on an update and kept on an unrelated one', async () => {
      const { service } = build();
      const flow = await service.create({ ...flowWith(ring({ groupId: 'g1' })), record: false }, caller);
      expect((await service.update(flow.id, { name: 'Still quiet' }, caller)).record).toBe(false);
      expect((await service.update(flow.id, { record: true }, caller)).record).toBe(true);
    });
  });

  it('the three-answer form writes the target shape', async () => {
    const { service } = build();
    const flow = await service.createSimple({ name: 'Main', groupId: 'g1', greeting: 'Hi' }, caller);
    expect(flow.nodes.ring).toMatchObject({ type: 'ring', target: { kind: 'group', id: 'g1' }, next: 'end' });
  });
});
