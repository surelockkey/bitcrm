import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CallGroupsService } from 'src/call-groups/call-groups.service';
import type { CallGroup } from '@bitcrm/types';

/** Directory + presence are the two sources membership is checked against. */
const DIRECTORY = [
  { id: 'u-dana', name: 'Dana Petrenko', roleId: 'dispatcher', phone: '+14045550101' },
  { id: 'u-marco', name: 'Marco Ruiz', roleId: 'tech', phone: '+14045550134' },
  { id: 'u-tamir', name: 'Tamir Levi', roleId: 'tech' }, // no personal number
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

  const service = new CallGroupsService(
    repository as never,
    directory as never,
    presence as never,
  );
  return { service, repository, directory, presence, store };
}

const caller = { id: 'u-admin' };
const member = (userId: string, over: Record<string, unknown> = {}) => ({
  userId,
  channel: 'softphone' as const,
  ...over,
});

describe('CallGroupsService', () => {
  describe('create', () => {
    it('stores the person and the channel, never their number', async () => {
      const { service, store } = build();

      const group = await service.create(
        { name: 'Dispatch', members: [member('u-marco', { channel: 'both' })] },
        caller,
      );

      expect(group.name).toBe('Dispatch');
      // Stored: identity only. The number is resolved on the way out.
      expect(store.get(group.id)!.members).toEqual([
        { userId: 'u-marco', channel: 'both', order: 0, enabled: true },
      ]);
      expect(group.members[0].phone).toBe('+14045550134');
    });

    it('defaults to ringing everyone at once', async () => {
      const { service } = build();
      const group = await service.create({ name: 'Dispatch', members: [member('u-dana')] }, caller);
      expect(group.type).toBe('ring_all');
      expect(group.ringSeconds).toBe(25);
    });

    it('refuses a second group with the same name, whatever the casing', async () => {
      const { service } = build();
      await service.create({ name: 'Dispatch', members: [member('u-dana')] }, caller);

      await expect(
        service.create({ name: '  dispatch ', members: [member('u-marco')] }, caller),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a personal channel for somebody with no number on file', async () => {
      const { service } = build();

      await expect(
        service.create(
          { name: 'Dispatch', members: [member('u-tamir', { channel: 'personal' })] },
          caller,
        ),
      ).rejects.toThrow(/Tamir Levi has no personal number/);
    });

    it('refuses somebody who is not an active user', async () => {
      const { service } = build();
      await expect(
        service.create({ name: 'Dispatch', members: [member('u-ghost')] }, caller),
      ).rejects.toThrow(/not an active user/);
    });

    it('refuses the same person twice', async () => {
      const { service } = build();
      await expect(
        service.create(
          { name: 'Dispatch', members: [member('u-dana'), member('u-dana', { channel: 'both' })] },
          caller,
        ),
      ).rejects.toThrow(/cannot be added twice/);
    });

    it('caps membership, because every parallel leg is billed', async () => {
      const { service } = build();
      const many = Array.from({ length: 21 }, (_, i) => member(`u-${i}`));
      await expect(
        service.create({ name: 'Everyone', members: many }, caller),
      ).rejects.toThrow(/at most 20 members/);
    });

    it('lets an empty group be saved, but not left active', async () => {
      const { service } = build();

      const draft = await service.create({ name: 'Draft', members: [], active: false }, caller);
      expect(draft.members).toEqual([]);

      await expect(
        service.create({ name: 'Live', members: [] }, caller),
      ).rejects.toThrow(/nobody to ring/);
    });
  });

  describe('reading', () => {
    it('resolves names, numbers and softphone status fresh every read', async () => {
      const { service } = build();
      const group = await service.create(
        { name: 'Dispatch', members: [member('u-dana'), member('u-tamir')] },
        caller,
      );

      const [dana, tamir] = (await service.findById(group.id)).members;
      expect(dana).toMatchObject({ name: 'Dana Petrenko', softphoneOnline: true, missing: false });
      expect(tamir).toMatchObject({ name: 'Tamir Levi', softphoneOnline: false, phone: undefined });
    });

    it('flags a member who has left rather than dropping them silently', async () => {
      const seed: CallGroup = {
        id: 'g1',
        name: 'Dispatch',
        type: 'ring_all',
        members: [{ userId: 'u-departed', channel: 'softphone', order: 0, enabled: true }],
        active: true,
        ringSeconds: 25,
        createdBy: 'u-admin',
        createdAt: '',
        updatedAt: '',
      };
      const { service } = build([seed]);

      const [gone] = (await service.findById('g1')).members;
      expect(gone).toMatchObject({ userId: 'u-departed', missing: true, name: undefined });
    });

    it('404s for a group that does not exist', async () => {
      const { service } = build();
      await expect(service.findById('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setMembers', () => {
    it('replaces the whole list in one write', async () => {
      const { service, store } = build();
      const group = await service.create(
        { name: 'Dispatch', members: [member('u-dana')] },
        caller,
      );

      await service.setMembers(
        group.id,
        [member('u-marco', { channel: 'both' }), member('u-tamir')],
        caller,
      );

      expect(store.get(group.id)!.members.map((m) => m.userId)).toEqual(['u-marco', 'u-tamir']);
    });

    it('will not empty an active group', async () => {
      const { service } = build();
      const group = await service.create({ name: 'Dispatch', members: [member('u-dana')] }, caller);

      await expect(service.setMembers(group.id, [], caller)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('resolveTargets', () => {
    const group = (members: CallGroup['members']): CallGroup => ({
      id: 'g1',
      name: 'Dispatch',
      type: 'ring_all',
      members,
      active: true,
      ringSeconds: 25,
      createdBy: 'u-admin',
      createdAt: '',
      updatedAt: '',
    });

    it('rings a softphone only while its owner is online', async () => {
      const { service } = build([], ['u-dana']);

      const targets = await service.resolveTargets(
        group([
          { userId: 'u-dana', channel: 'softphone', order: 0, enabled: true },
          { userId: 'u-marco', channel: 'softphone', order: 1, enabled: true },
        ]),
      );

      expect(targets).toEqual([
        { userId: 'u-dana', channel: 'softphone', endpoint: 'client:u-dana' },
      ]);
    });

    it('rings a personal number regardless of presence — that is the point of it', async () => {
      const { service } = build([], []);

      const targets = await service.resolveTargets(
        group([{ userId: 'u-marco', channel: 'personal', order: 0, enabled: true }]),
      );

      expect(targets).toEqual([
        { userId: 'u-marco', channel: 'personal', endpoint: '+14045550134' },
      ]);
    });

    it('gives "both" two legs when the softphone is up, one when it is not', async () => {
      const both = group([{ userId: 'u-marco', channel: 'both', order: 0, enabled: true }]);

      expect(await build([], ['u-marco']).service.resolveTargets(both)).toHaveLength(2);
      expect(await build([], []).service.resolveTargets(both)).toEqual([
        { userId: 'u-marco', channel: 'personal', endpoint: '+14045550134' },
      ]);
    });

    it('skips a paused member and a departed user without failing the call', async () => {
      const { service } = build([], ['u-dana', 'u-marco']);

      const targets = await service.resolveTargets(
        group([
          { userId: 'u-dana', channel: 'softphone', order: 0, enabled: false },
          { userId: 'u-departed', channel: 'softphone', order: 1, enabled: true },
          { userId: 'u-marco', channel: 'softphone', order: 2, enabled: true },
        ]),
      );

      expect(targets.map((t) => t.userId)).toEqual(['u-marco']);
    });

    it('rings in the stored order, not the order they were added', async () => {
      const { service } = build([], ['u-dana', 'u-marco']);

      const targets = await service.resolveTargets(
        group([
          { userId: 'u-dana', channel: 'softphone', order: 2, enabled: true },
          { userId: 'u-marco', channel: 'softphone', order: 1, enabled: true },
        ]),
      );

      expect(targets.map((t) => t.userId)).toEqual(['u-marco', 'u-dana']);
    });
  });
});
