import { FlowRunnerService } from 'src/voice/flow-runner.service';
import type { CallFlow, CallFlowNode } from '@bitcrm/types';

/**
 * The rule these exist to protect: a flow that is wrong must never mean a
 * silent line. Every failure returns null, and null sends the caller down the
 * path every number used before flows existed.
 */
const CONFIG = { publicBaseUrl: 'https://api.test' } as never;

function flowOf(nodes: Record<string, CallFlowNode>, entry: string): CallFlow {
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
  };
}

const GREETING_THEN_RING = flowOf(
  {
    hello: { id: 'hello', type: 'say', text: 'Thanks for calling.', next: 'ring' },
    ring: { id: 'ring', type: 'ring', groupId: 'g1', next: 'vm' },
    vm: { id: 'vm', type: 'voicemail', prompt: 'Leave a message.', maxSeconds: 120 },
  },
  'hello',
);

function build(over: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  const redis = {
    client: {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    },
  };
  const flows = {
    findByNumber: jest.fn(async () => GREETING_THEN_RING),
    ...(over.flows as object),
  };
  const groups = {
    findRaw: jest.fn(async () => ({ id: 'g1', name: 'Dispatch', ringSeconds: 25 })),
    resolveTargets: jest.fn(async () => [
      { userId: 'u-dana', channel: 'softphone', endpoint: 'client:u-dana' },
      { userId: 'u-marco', channel: 'personal', endpoint: '+14045550134' },
    ]),
    ...(over.groups as object),
  };
  const conference = {
    initInbound: jest.fn(
      async (
        _sid: string,
        _from: string,
        _to: string,
        _legs: unknown,
        _options: unknown,
      ) => undefined,
    ),
    sharedConferenceAttrs: jest.fn(() => ({})),
  };
  const calls = { applyLifecycle: jest.fn(async () => undefined) };

  const runner = new FlowRunnerService(
    CONFIG,
    flows as never,
    groups as never,
    conference as never,
    calls as never,
    redis as never,
  );
  return { runner, flows, groups, conference, calls, store };
}

describe('FlowRunnerService — running a call through its flow', () => {
  it('speaks the greeting and points Twilio at the next step', async () => {
    const { runner } = build();

    const twiml = await runner.startInbound('CA1', '+14045551234', '+15412830739');

    expect(twiml).toContain('<Say>Thanks for calling.</Say>');
    expect(twiml).toContain('/voice/flow?node=ring');
  });

  it('rings the group and parks the caller in the conference', async () => {
    const { runner, conference } = build();
    await runner.startInbound('CA1', '+14045551234', '+15412830739');

    const twiml = await runner.resume('CA1', 'ring');

    expect(twiml).toContain('<Conference');
    const [, from, to, legs, options] = conference.initInbound.mock.calls[0] as [
      string, string, string, Array<{ endpoint: string; callerId: string }>,
      { ringSeconds?: number; noAnswerUrl?: string },
    ];
    expect(from).toBe('+14045551234');
    expect(to).toBe('+15412830739');
    // A softphone shows the customer so the screen-pop works; a personal phone
    // shows our number, so the tech's callback comes back through the CRM.
    expect(legs).toEqual([
      { endpoint: 'client:u-dana', callerId: '+14045551234' },
      { endpoint: '+14045550134', callerId: '+15412830739' },
    ]);
    expect(options.ringSeconds).toBe(25);
    // …and nobody answering continues the flow rather than hanging up.
    expect(options.noAnswerUrl).toContain('node=vm');
  });

  it('records a voicemail with a beep and a hard stop', async () => {
    const { runner } = build();
    await runner.startInbound('CA1', '+14045551234', '+15412830739');

    const twiml = await runner.resume('CA1', 'vm');

    expect(twiml).toContain('<Say>Leave a message.</Say>');
    expect(twiml).toContain('maxLength="120"');
    expect(twiml).toContain('transcribe="true"');
  });

  it('skips a ring step when nobody in the group is reachable', async () => {
    const { runner, conference } = build({
      groups: { resolveTargets: jest.fn(async () => []) },
    });
    await runner.startInbound('CA1', '+14045551234', '+15412830739');

    const twiml = await runner.resume('CA1', 'ring');

    // Straight to voicemail — ringing nothing would just waste the caller's time.
    expect(conference.initInbound).not.toHaveBeenCalled();
    expect(twiml).toContain('<Record');
  });

  describe('never a silent line', () => {
    it('falls back when the number has no flow', async () => {
      const { runner } = build({ flows: { findByNumber: jest.fn(async () => null) } });
      expect(await runner.startInbound('CA1', '+1404', '+1541')).toBeNull();
    });

    it('falls back when looking the flow up throws', async () => {
      const { runner } = build({
        flows: { findByNumber: jest.fn(async () => { throw new Error('dynamo down'); }) },
      });
      expect(await runner.startInbound('CA1', '+1404', '+1541')).toBeNull();
    });

    it('falls back when the first step is missing', async () => {
      const broken = flowOf({ a: { id: 'a', type: 'say', text: 'hi' } }, 'nope');
      const { runner } = build({ flows: { findByNumber: jest.fn(async () => broken) } });
      expect(await runner.startInbound('CA1', '+1404', '+1541')).toBeNull();
    });

    it('falls back when a resumed step no longer exists', async () => {
      const { runner } = build();
      await runner.startInbound('CA1', '+1404', '+1541');
      expect(await runner.resume('CA1', 'ghost')).toBeNull();
    });

    it('falls back when there is no state for the call', async () => {
      const { runner } = build();
      expect(await runner.resume('CA-unknown', 'ring')).toBeNull();
    });

    it('falls back when the group a step rings has been deleted', async () => {
      const { runner } = build({ groups: { findRaw: jest.fn(async () => null) } });
      await runner.startInbound('CA1', '+1404', '+1541');
      expect(await runner.resume('CA1', 'ring')).toBeNull();
    });

    it('falls back when a step throws mid-flight', async () => {
      const { runner } = build({
        groups: { resolveTargets: jest.fn(async () => { throw new Error('twilio down'); }) },
      });
      await runner.startInbound('CA1', '+1404', '+1541');
      expect(await runner.resume('CA1', 'ring')).toBeNull();
    });
  });

  it('gives up rather than looping a caller forever', async () => {
    const loop = flowOf(
      { a: { id: 'a', type: 'say', text: 'hi', next: 'a' } },
      'a',
    );
    const { runner } = build({ flows: { findByNumber: jest.fn(async () => loop) } });
    await runner.startInbound('CA1', '+1404', '+1541');

    let twiml: string | null = null;
    for (let i = 0; i < 25; i++) twiml = await runner.resume('CA1', 'a');

    // A trapped customer is also a bill that keeps running.
    expect(twiml).toContain('<Hangup');
    expect(twiml).toContain('something went wrong');
  });

  it('pins the flow it started on, so an edit mid-call cannot move the caller', async () => {
    const { runner, flows } = build();
    await runner.startInbound('CA1', '+1404', '+1541');

    // The flow is rewritten while this caller is still listening to the greeting.
    flows.findByNumber.mockResolvedValue(
      flowOf({ other: { id: 'other', type: 'hangup', text: 'gone' } }, 'other'),
    );

    const twiml = await runner.resume('CA1', 'ring');
    expect(twiml).toContain('<Conference');
  });
});
