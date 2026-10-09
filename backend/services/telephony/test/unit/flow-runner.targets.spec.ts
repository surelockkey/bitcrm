import { FlowRunnerService } from 'src/voice/flow-runner.service';
import type { CallFlow, CallFlowNode } from '@bitcrm/types';

/**
 * A Forward step rings whoever its target names — a group as before, one
 * user, a device, an external number — for "move to next step after N sec",
 * then takes its no-answer exit; and a flow whose last step goes unanswered
 * reaches the account's fallback number when one is set.
 */
const CONFIG = { publicBaseUrl: 'https://api.test' } as never;

function flowOf(nodes: Record<string, CallFlowNode>, entry: string, over: Partial<CallFlow> = {}): CallFlow {
  return {
    id: 'f1',
    name: 'Main line',
    numbers: ['+15412830739'],
    entryNodeId: entry,
    nodes,
    active: true,
    version: 1,
    createdBy: 'u1',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

type Leg = { endpoint: string; callerId: string; whisper: boolean };
type Options = { ringSeconds?: number; noAnswerUrl?: string };

function build(flow: CallFlow, over: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  const redis = {
    client: {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    },
  };
  const flows = { findByNumber: jest.fn(async () => flow) };
  const groups = {
    findRaw: jest.fn(async (id: string) => (id === 'g1' ? { id, name: 'Dispatch', ringSeconds: 25 } : null)),
    resolveTargets: jest.fn(async () => [{ userId: 'u-dana', channel: 'softphone', endpoint: 'client:u-dana' }]),
    resolveUserTargets: jest.fn(async (id: string) =>
      id === 'u-riley'
        ? {
            name: 'Riley CSR',
            targets: [
              { userId: 'u-riley', channel: 'softphone', endpoint: 'client:u-riley' },
              { userId: 'u-riley', channel: 'personal', endpoint: '+14045550134' },
            ],
          }
        : null,
    ),
    resolveDeviceTarget: jest.fn(async (id: string) =>
      id === 'd-ct'
        ? { name: 'SURE CT LOCKSMITH', targets: [{ deviceId: 'd-ct', channel: 'device', endpoint: '+12039893585' }] }
        : id === 'd-off'
          ? { name: 'Paused line', targets: [] }
          : null,
    ),
    ...(over.groups as object),
  };
  const conference = {
    initInbound: jest.fn(async (_sid: string, _from: string, _to: string, _legs: Leg[], _options: Options) => undefined),
    sharedConferenceAttrs: jest.fn(() => ({ record: 'record-from-start' })),
  };
  const calls = {
    applyLifecycle: jest.fn(async () => undefined),
    recordFlowStep: jest.fn(async () => undefined),
    getBySid: jest.fn(async () => ({ answeredAt: '2026-08-19T10:00:00.000Z' })),
  };
  const settings = {
    fallbackNumber: jest.fn(async () => (over.fallback as string | null) ?? null),
  };

  const runner = new FlowRunnerService(
    CONFIG,
    flows as never,
    groups as never,
    conference as never,
    calls as never,
    redis as never,
    undefined,
    settings as never,
  );
  const ringCall = () => {
    const [, , , legs, options] = conference.initInbound.mock.calls[0] as unknown as [string, string, string, Leg[], Options];
    return { legs, options };
  };
  return { runner, groups, conference, calls, settings, ringCall };
}

const FROM = '+14045551234';
const TO = '+15412830739';

describe('FlowRunnerService — Forward targets', () => {
  it('rings a group named the old way, with its own ring time', async () => {
    const { runner, groups, ringCall } = build(
      flowOf({ ring: { id: 'ring', type: 'ring', groupId: 'g1', next: 'vm' }, vm: { id: 'vm', type: 'voicemail', prompt: 'Hi', maxSeconds: 60 } }, 'ring'),
    );
    const twiml = await runner.startInbound('CA1', FROM, TO);

    expect(twiml).toContain('<Conference');
    expect(groups.findRaw).toHaveBeenCalledWith('g1');
    expect(ringCall().options.ringSeconds).toBe(25);
    expect(ringCall().options.noAnswerUrl).toContain('node=vm');
  });

  it('"move to next step after N sec" overrides the group ring time', async () => {
    const { runner, ringCall } = build(
      flowOf({ ring: { id: 'ring', type: 'ring', target: { kind: 'group', id: 'g1' }, timeoutSec: 300 } }, 'ring'),
    );
    await runner.startInbound('CA1', FROM, TO);
    expect(ringCall().options.ringSeconds).toBe(300);
  });

  it('rings one user on their softphone and their own number', async () => {
    const { runner, ringCall, calls } = build(
      flowOf({ ring: { id: 'ring', type: 'ring', target: { kind: 'user', id: 'u-riley' } } }, 'ring'),
    );
    await runner.startInbound('CA1', FROM, TO);

    expect(ringCall().legs).toEqual([
      { endpoint: 'client:u-riley', callerId: FROM, whisper: false },
      { endpoint: '+14045550134', callerId: TO, whisper: false },
    ]);
    // Workiz's default when the step says nothing.
    expect(ringCall().options.ringSeconds).toBe(60);
    expect(calls.recordFlowStep).toHaveBeenCalledWith('CA1', expect.objectContaining({ detail: 'Rang Riley CSR — 2 phones' }));
  });

  it('forwards to an external number as one leg from our number, honouring the whisper gate', async () => {
    const { runner, ringCall, calls } = build(
      flowOf({ ring: { id: 'ring', type: 'ring', target: { kind: 'external', number: '+18888996849' }, timeoutSec: 300, whisper: true } }, 'ring'),
    );
    await runner.startInbound('CA1', FROM, TO);

    // Twilio only places a leg from a number we own, so an outside phone sees
    // our number, never the caller's.
    expect(ringCall().legs).toEqual([{ endpoint: '+18888996849', callerId: TO, whisper: true }]);
    expect(ringCall().options.ringSeconds).toBe(300);
    expect(calls.recordFlowStep).toHaveBeenCalledWith('CA1', expect.objectContaining({ detail: expect.stringContaining('(888) 899-6849') }));
  });

  it('rings a device on its number', async () => {
    const { runner, ringCall } = build(flowOf({ ring: { id: 'ring', type: 'ring', target: { kind: 'device', id: 'd-ct' } } }, 'ring'));
    await runner.startInbound('CA1', FROM, TO);
    expect(ringCall().legs).toEqual([{ endpoint: '+12039893585', callerId: TO, whisper: false }]);
  });

  it('a paused device is nobody reachable: straight to the next step', async () => {
    const { runner, conference } = build(
      flowOf({ ring: { id: 'ring', type: 'ring', target: { kind: 'device', id: 'd-off' }, next: 'bye' }, bye: { id: 'bye', type: 'hangup', text: 'Bye' } }, 'ring'),
    );
    const twiml = await runner.startInbound('CA1', FROM, TO);
    expect(conference.initInbound).not.toHaveBeenCalled();
    expect(twiml).toContain('<Say>Bye</Say>');
  });

  it('a device that is gone falls back, like a group that is gone', async () => {
    const { runner } = build(flowOf({ ring: { id: 'ring', type: 'ring', target: { kind: 'device', id: 'd-gone' } } }, 'ring'));
    expect(await runner.startInbound('CA1', FROM, TO)).toBeNull();
  });

  it('a ring step with no target falls back rather than ringing silence', async () => {
    const { runner } = build(flowOf({ ring: { id: 'ring', type: 'ring' } as CallFlowNode }, 'ring'));
    expect(await runner.startInbound('CA1', FROM, TO)).toBeNull();
  });

  describe('Record Call Flow', () => {
    it('records by default and keeps the conference unrecorded when the flow says so', async () => {
      const recorded = build(flowOf({ ring: { id: 'ring', type: 'ring', groupId: 'g1' } }, 'ring'));
      expect(await recorded.runner.startInbound('CA1', FROM, TO)).toContain('record="record-from-start"');

      const quiet = build(flowOf({ ring: { id: 'ring', type: 'ring', groupId: 'g1' } }, 'ring', { record: false }));
      expect(await quiet.runner.startInbound('CA2', FROM, TO)).toContain('record="do-not-record"');
    });
  });

  describe('the account fallback number', () => {
    const lastStep = () => flowOf({ ring: { id: 'ring', type: 'ring', groupId: 'g1' } }, 'ring');

    it('is where an unanswered last step sends the caller', async () => {
      const { runner, ringCall } = build(lastStep(), { fallback: '+15550001111' });
      await runner.startInbound('CA1', FROM, TO);
      expect(ringCall().options.noAnswerUrl).toContain('node=%24fallback');
    });

    it('is nowhere when none is set: the call simply ends as before', async () => {
      const { runner, ringCall } = build(lastStep());
      await runner.startInbound('CA1', FROM, TO);
      expect(ringCall().options.noAnswerUrl).toBeUndefined();
    });

    it('rings for a minute from our number, then the call ends', async () => {
      const { runner, conference, calls } = build(lastStep(), { fallback: '+15550001111' });
      await runner.startInbound('CA1', FROM, TO);
      conference.initInbound.mockClear();

      const twiml = await runner.resume('CA1', '$fallback');

      expect(twiml).toContain('<Conference');
      const [, , , legs, options] = conference.initInbound.mock.calls[0] as unknown as [string, string, string, Leg[], Options];
      expect(legs).toEqual([{ endpoint: '+15550001111', callerId: TO, whisper: false }]);
      expect(options).toEqual({ ringSeconds: 60 });
      expect(calls.recordFlowStep).toHaveBeenCalledWith('CA1', expect.objectContaining({ nodeId: '$fallback', detail: expect.stringContaining('(555) 000-1111') }));
    });

    it('takes over when nobody in the last step is reachable', async () => {
      const { runner, ringCall } = build(lastStep(), {
        fallback: '+15550001111',
        groups: { resolveTargets: jest.fn(async () => []) },
      });
      const twiml = await runner.startInbound('CA1', FROM, TO);
      expect(twiml).toContain('<Conference');
      expect(ringCall().legs).toEqual([{ endpoint: '+15550001111', callerId: TO, whisper: false }]);
    });

    it('is the apology when none is set and nobody is reachable', async () => {
      const { runner } = build(lastStep(), { groups: { resolveTargets: jest.fn(async () => []) } });
      expect(await runner.startInbound('CA1', FROM, TO)).toContain('nobody is available');
    });
  });
});
