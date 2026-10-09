import { BadRequestException } from '@nestjs/common';
import { CallGroupsService } from 'src/call-groups/call-groups.service';
import type { CallDevice, CallGroup } from '@bitcrm/types';

/**
 * Workiz's groups ring "Users and devices": a desk phone or shop line from the
 * Devices catalog sits in a group beside the people. Devices are their own
 * list (`deviceMembers`), so a group saved before devices existed reads and
 * rings exactly as it did.
 */
const DIRECTORY = [
  { id: 'u-dana', name: 'Dana Petrenko', roleId: 'dispatcher', phone: '+14045550101' },
  { id: 'u-tamir', name: 'Tamir Levi', roleId: 'tech' }, // no personal number
];

const DEVICES: CallDevice[] = [
  { id: 'd-ct', name: 'SURE CT LOCKSMITH', number: '+12039893585', type: 'shop_line', active: true, createdBy: 'i', createdAt: '', updatedAt: '' },
  { id: 'd-sip', name: 'Shop SIP', sipAddress: 'shop@sip.example.com', type: 'other', active: true, createdBy: 'i', createdAt: '', updatedAt: '' },
  { id: 'd-off', name: 'Paused line', number: '+12035550199', type: 'desk_phone', active: false, createdBy: 'i', createdAt: '', updatedAt: '' },
];

function build(seed: CallGroup[] = [], online: string[] = ['u-dana']) {
  const store = new Map(seed.map((g) => [g.id, structuredClone(g)]));
  const repository = {
    listAll: jest.fn(async () => [...store.values()]),
    get: jest.fn(async (id: string) => store.get(id) ?? null),
    create: jest.fn(async (g: CallGroup) => void store.set(g.id, g)),
    put: jest.fn(async (g: CallGroup) => void store.set(g.id, g)),
    delete: jest.fn(async (id: string) => void store.delete(id)),
  };
  const directory = { list: jest.fn(async () => DIRECTORY) };
  const presence = { listOnline: jest.fn(async () => online) };
  const devices = {
    list: jest.fn(async () => DEVICES),
    findRaw: jest.fn(async (id: string) => DEVICES.find((d) => d.id === id) ?? null),
  };
  const service = new CallGroupsService(repository as never, directory as never, presence as never, devices as never);
  return { service, store, devices };
}

const caller = { id: 'u-admin' };
const legacyGroup = (): CallGroup => ({
  id: 'g-old',
  name: 'Old dispatch',
  type: 'ring_all',
  members: [{ userId: 'u-dana', channel: 'softphone', order: 0, enabled: true }],
  active: true,
  ringSeconds: 25,
  createdBy: 'u',
  createdAt: '',
  updatedAt: '',
});

describe('CallGroupsService — devices in a group', () => {
  it('stores a device member as its id and position, and reads its name and number back', async () => {
    const { service, store } = build();

    const group = await service.create(
      { name: 'CT shop', members: [{ userId: 'u-dana', channel: 'softphone' }], deviceMembers: [{ deviceId: 'd-ct' }] },
      caller,
    );

    expect(store.get(group.id)!.deviceMembers).toEqual([{ deviceId: 'd-ct', order: 0, enabled: true }]);
    expect(group.deviceMembers).toEqual([
      { deviceId: 'd-ct', order: 0, enabled: true, name: 'SURE CT LOCKSMITH', number: '+12039893585', missing: false },
    ]);
  });

  it('a group of devices alone can be live — a shop line answers calls', async () => {
    const { service } = build();
    const group = await service.create({ name: 'Shop only', deviceMembers: [{ deviceId: 'd-ct' }] }, caller);
    expect(group.active).toBe(true);
    expect(group.members).toEqual([]);
  });

  it('refuses a device that is not in the catalog, and the same device twice', async () => {
    const { service } = build();
    await expect(
      service.create({ name: 'X', deviceMembers: [{ deviceId: 'd-gone' }] }, caller),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({ name: 'X', deviceMembers: [{ deviceId: 'd-ct' }, { deviceId: 'd-ct' }] }, caller),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('counts people and devices together against the ring limit', async () => {
    const { service } = build();
    const many = Array.from({ length: 19 }, (_, i) => ({ userId: `u-${i}` }));
    await expect(
      service.create(
        { name: 'Too many', members: many.map((m) => ({ ...m, channel: 'softphone' as const })), deviceMembers: [{ deviceId: 'd-ct' }, { deviceId: 'd-sip' }] },
        caller,
      ),
    ).rejects.toThrow(/at most 20/);
  });

  it('replaces the devices with the people in one membership write, and keeps them when not sent', async () => {
    const { service, store } = build();
    const group = await service.create({ name: 'CT shop', deviceMembers: [{ deviceId: 'd-ct' }] }, caller);

    await service.setMembers(group.id, [{ userId: 'u-dana', channel: 'softphone' }], caller, [{ deviceId: 'd-sip' }, { deviceId: 'd-ct', enabled: false }]);
    expect(store.get(group.id)!.deviceMembers).toEqual([
      { deviceId: 'd-sip', order: 0, enabled: true },
      { deviceId: 'd-ct', order: 1, enabled: false },
    ]);

    await service.setMembers(group.id, [{ userId: 'u-dana', channel: 'softphone' }], caller);
    expect(store.get(group.id)!.deviceMembers).toHaveLength(2);
  });

  it('a group saved before devices lists and rings as it always did', async () => {
    const { service } = build([legacyGroup()]);
    const [group] = await service.list();
    expect(group.members[0].name).toBe('Dana Petrenko');
    expect(group.deviceMembers).toEqual([]);
    expect(await service.resolveTargets(legacyGroup())).toEqual([
      { userId: 'u-dana', channel: 'softphone', endpoint: 'client:u-dana' },
    ]);
  });

  it('marks a device that left the catalog rather than dropping it from the list', async () => {
    const { service } = build([{ ...legacyGroup(), deviceMembers: [{ deviceId: 'd-gone', order: 0, enabled: true }] }]);
    const [group] = await service.list();
    expect(group.deviceMembers).toEqual([{ deviceId: 'd-gone', order: 0, enabled: true, missing: true }]);
  });

  describe('resolveTargets', () => {
    it('rings a device on its number, a SIP device on sip:, and skips paused, disabled and missing ones', async () => {
      const { service } = build();
      const group: CallGroup = {
        ...legacyGroup(),
        members: [],
        deviceMembers: [
          { deviceId: 'd-ct', order: 0, enabled: true },
          { deviceId: 'd-sip', order: 1, enabled: true },
          { deviceId: 'd-off', order: 2, enabled: true },
          { deviceId: 'd-gone', order: 3, enabled: true },
          { deviceId: 'd-ct', order: 4, enabled: false },
        ],
      };
      expect(await service.resolveTargets(group)).toEqual([
        { deviceId: 'd-ct', channel: 'device', endpoint: '+12039893585' },
        { deviceId: 'd-sip', channel: 'device', endpoint: 'sip:shop@sip.example.com' },
      ]);
    });
  });

  describe('resolveUserTargets — a Forward to one user', () => {
    it('rings their softphone when it is registered and their own number when they have one', async () => {
      const { service } = build([], ['u-dana']);
      expect(await service.resolveUserTargets('u-dana')).toEqual({
        name: 'Dana Petrenko',
        targets: [
          { userId: 'u-dana', channel: 'softphone', endpoint: 'client:u-dana' },
          { userId: 'u-dana', channel: 'personal', endpoint: '+14045550101' },
        ],
      });
    });

    it('rings nothing for somebody offline with no number, and is nobody when not in the directory', async () => {
      const { service } = build([], []);
      expect(await service.resolveUserTargets('u-tamir')).toEqual({ name: 'Tamir Levi', targets: [] });
      expect(await service.resolveUserTargets('u-nobody')).toBeNull();
    });
  });

  it('rings one device for a Forward to a device, nothing when it is paused, nobody when it is gone', async () => {
    const { service } = build();
    expect(await service.resolveDeviceTarget('d-ct')).toEqual({
      name: 'SURE CT LOCKSMITH',
      targets: [{ deviceId: 'd-ct', channel: 'device', endpoint: '+12039893585' }],
    });
    expect(await service.resolveDeviceTarget('d-off')).toEqual({ name: 'Paused line', targets: [] });
    expect(await service.resolveDeviceTarget('d-gone')).toBeNull();
  });
});
