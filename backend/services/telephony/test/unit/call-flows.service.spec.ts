import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CallFlowsService } from 'src/call-flows/call-flows.service';
import type { CallFlow } from '@bitcrm/types';

function build(seed: CallFlow[] = [], groupExists = true) {
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
      if (!groupExists) throw new NotFoundException(`Call group ${id} not found`);
      return { id, name: 'Dispatch' };
    }),
  };
  return {
    service: new CallFlowsService(repository as never, groups as never),
    repository,
    groups,
    store,
  };
}

const caller = { id: 'u-admin' };
const simple = {
  name: 'Main line',
  groupId: 'g1',
  greeting: 'Thanks for calling.',
  numbers: ['+1 (541) 283-0739'],
};

describe('CallFlowsService', () => {
  describe('the three-answer form', () => {
    it('builds greeting → ring → voicemail in that order', async () => {
      const { service } = build();

      const flow = await service.createSimple(simple, caller);

      expect(flow.entryNodeId).toBe('greeting');
      expect(flow.nodes.greeting).toMatchObject({ type: 'say', next: 'ring' });
      expect(flow.nodes.ring).toMatchObject({ type: 'ring', groupId: 'g1', next: 'end' });
      expect(flow.nodes.end).toMatchObject({ type: 'voicemail' });
    });

    it('starts at the ring step when there is no greeting', async () => {
      const { service } = build();
      const flow = await service.createSimple({ ...simple, greeting: '' }, caller);
      expect(flow.entryNodeId).toBe('ring');
    });

    it('can hang up instead of taking a message', async () => {
      const { service } = build();
      const flow = await service.createSimple({ ...simple, noAnswer: 'hangup' }, caller);
      expect(flow.nodes.end).toMatchObject({ type: 'hangup' });
    });

    it('stores numbers in the one form calls arrive as', async () => {
      const { service } = build();
      const flow = await service.createSimple(simple, caller);
      // Twilio reports E.164; a number typed any other way still has to match.
      expect(flow.numbers).toEqual(['+15412830739']);
    });
  });

  describe('what it refuses to save', () => {
    it('a second flow with the same name', async () => {
      const { service } = build();
      await service.createSimple(simple, caller);
      await expect(
        service.createSimple({ ...simple, numbers: [] }, caller),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('a number another flow already answers', async () => {
      const { service } = build();
      await service.createSimple(simple, caller);
      await expect(
        service.createSimple({ ...simple, name: 'Second' }, caller),
      ).rejects.toThrow(/already answered by "Main line"/);
    });

    it('a number that is not dialable', async () => {
      const { service } = build();
      await expect(
        service.createSimple({ ...simple, numbers: ['nonsense'] }, caller),
      ).rejects.toThrow(/not a valid phone number/);
    });

    it('a ring step naming a group that no longer exists', async () => {
      const { service } = build([], false);
      await expect(service.createSimple(simple, caller)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('a step pointing at one that does not exist', async () => {
      const { service } = build();
      await expect(
        service.create(
          {
            name: 'Broken',
            entryNodeId: 'a',
            nodes: { a: { id: 'a', type: 'say', text: 'hi', next: 'ghost' } },
          },
          caller,
        ),
      ).rejects.toThrow(/points at a step that does not exist/);
    });

    it('a flow that loops back on itself', async () => {
      const { service } = build();
      await expect(
        service.create(
          {
            name: 'Loop',
            entryNodeId: 'a',
            nodes: {
              a: { id: 'a', type: 'say', text: 'hi', next: 'b' },
              b: { id: 'b', type: 'say', text: 'again', next: 'a' },
            },
          },
          caller,
        ),
      ).rejects.toThrow(/loops back on itself/);
    });

    it('an active flow with no steps at all', async () => {
      const { service } = build();
      await expect(
        service.create({ name: 'Empty', nodes: {} }, caller),
      ).rejects.toThrow(/would answer with silence/);

      // …but a draft is fine.
      const draft = await service.create(
        { name: 'Draft', nodes: {}, active: false },
        caller,
      );
      expect(draft.active).toBe(false);
    });
  });

  describe('finding the flow for a number', () => {
    it('matches however the number was written', async () => {
      const { service } = build();
      await service.createSimple(simple, caller);

      expect(await service.findByNumber('+15412830739')).not.toBeNull();
      expect(await service.findByNumber('(541) 283-0739')).not.toBeNull();
      expect(await service.findByNumber('+14045550000')).toBeNull();
    });

    it('ignores a paused flow, so pausing really stops it answering', async () => {
      const { service } = build();
      const flow = await service.createSimple(simple, caller);
      await service.update(flow.id, { active: false }, caller);

      expect(await service.findByNumber('+15412830739')).toBeNull();
    });
  });

  it('bumps the version on every save, which is what pins a live call', async () => {
    const { service } = build();
    const flow = await service.createSimple(simple, caller);
    expect(flow.version).toBe(1);

    const updated = await service.update(flow.id, { name: 'Renamed' }, caller);
    expect(updated.version).toBe(2);
  });

  describe('branching steps', () => {
    const hoursAndMenu = {
      name: 'Main line',
      entryNodeId: 'hours',
      nodes: {
        hours: {
          id: 'hours', type: 'hours' as const, timezone: 'America/New_York',
          windows: [{ day: 1, open: '08:00', close: '18:00' }],
          openNext: 'menu', next: 'closed',
        },
        menu: {
          id: 'menu', type: 'menu' as const, prompt: 'Press 1.',
          options: [{ key: '1', label: 'Dispatch', next: 'ring' }],
          timeoutSeconds: 5, repeats: 1, next: 'ring',
        },
        ring: { id: 'ring', type: 'ring' as const, groupId: 'g1', next: 'closed' },
        closed: { id: 'closed', type: 'hangup' as const },
      },
    };

    it('accepts a flow that branches on hours and on a keypress', async () => {
      const { service } = build();
      const flow = await service.create(hoursAndMenu, caller);
      expect(Object.keys(flow.nodes)).toHaveLength(4);
    });

    it('checks branch targets, not just the main line', async () => {
      const { service } = build();
      const broken = structuredClone(hoursAndMenu);
      broken.nodes.hours.openNext = 'ghost';

      await expect(service.create(broken, caller)).rejects.toThrow(
        /points at a step that does not exist/,
      );
    });

    it('catches a loop down a branch', async () => {
      const { service } = build();
      const looped = structuredClone(hoursAndMenu);
      // Menu option 1 → ring → back to the menu.
      looped.nodes.ring.next = 'menu';

      await expect(service.create(looped, caller)).rejects.toThrow(/loops back on itself/);
    });

    it('refuses a menu that traps the caller or repeats a key', async () => {
      const { service } = build();

      const empty = structuredClone(hoursAndMenu);
      empty.nodes.menu.options = [];
      await expect(service.create(empty, caller)).rejects.toThrow(/traps the caller/);

      const duplicate = structuredClone(hoursAndMenu);
      duplicate.nodes.menu.options = [
        { key: '1', label: 'A', next: 'ring' },
        { key: '1', label: 'B', next: 'ring' },
      ];
      await expect(service.create({ ...duplicate, name: 'Other' }, caller)).rejects.toThrow(
        /both use 1/,
      );
    });

    it('refuses a key a phone cannot send', async () => {
      const { service } = build();
      const odd = structuredClone(hoursAndMenu);
      odd.nodes.menu.options = [{ key: 'A', label: 'A', next: 'ring' }];

      await expect(service.create(odd, caller)).rejects.toThrow(/not a key a phone can send/);
    });

    it('refuses opening hours with no windows — that is closed forever', async () => {
      const { service } = build();
      const noWindows = structuredClone(hoursAndMenu);
      noWindows.nodes.hours.windows = [];

      await expect(service.create(noWindows, caller)).rejects.toThrow(/closed forever/);
    });

    it('lets one group fall through to the next', async () => {
      const { service } = build();
      // The chain the flow model exists for: try dispatch, then the on-call
      // tech, then take a message.
      const chained = {
        name: 'Escalating',
        entryNodeId: 'first',
        nodes: {
          first: { id: 'first', type: 'ring' as const, groupId: 'g1', next: 'second' },
          second: { id: 'second', type: 'ring' as const, groupId: 'g2', next: 'vm' },
          vm: { id: 'vm', type: 'voicemail' as const, prompt: 'Message.', maxSeconds: 60 },
        },
      };

      const flow = await service.create(chained, caller);
      expect(flow.nodes.first).toMatchObject({ next: 'second' });
    });
  });
});
