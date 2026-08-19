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
  const calls = {
    applyLifecycle: jest.fn(async () => undefined),
    recordFlowStep: jest.fn(async () => undefined),
    // Answered by default; the "never answered" cases override it.
    getBySid: jest.fn(async () => ({ answeredAt: '2026-08-19T10:00:00.000Z' })),
    ...(over.calls as object),
  };

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
      { endpoint: 'client:u-dana', callerId: '+14045551234', whisper: false },
      { endpoint: '+14045550134', callerId: '+15412830739', whisper: false },
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

  describe('business hours', () => {
    const hoursFlow = flowOf(
      {
        hours: {
          id: 'hours',
          type: 'hours',
          timezone: 'America/New_York',
          windows: [{ day: 3, open: '08:00', close: '18:00' }],
          openNext: 'ring',
          next: 'closed',
        },
        ring: { id: 'ring', type: 'ring', groupId: 'g1' },
        closed: { id: 'closed', type: 'hangup', text: 'We are closed.' },
      },
      'hours',
    );

    it('takes the open branch during opening hours', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-19T13:00:00Z'));
      const { runner } = build({ flows: { findByNumber: jest.fn(async () => hoursFlow) } });

      const twiml = await runner.startInbound('CA1', '+1404', '+1541');

      expect(twiml).toContain('<Conference');
      jest.useRealTimers();
    });

    it('takes the closed branch outside them', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-20T03:00:00Z'));
      const { runner } = build({ flows: { findByNumber: jest.fn(async () => hoursFlow) } });

      const twiml = await runner.startInbound('CA1', '+1404', '+1541');

      expect(twiml).toContain('We are closed.');
      expect(twiml).toContain('<Hangup');
      jest.useRealTimers();
    });
  });

  describe('the voice menu', () => {
    const menuFlow = flowOf(
      {
        menu: {
          id: 'menu',
          type: 'menu',
          prompt: 'Press 1 for dispatch, 2 for accounts.',
          options: [
            { key: '1', label: 'Dispatch', next: 'ring' },
            { key: '2', label: 'Accounts', next: 'bye' },
          ],
          timeoutSeconds: 5,
          repeats: 1,
          next: 'ring',
        },
        ring: { id: 'ring', type: 'ring', groupId: 'g1' },
        bye: { id: 'bye', type: 'hangup', text: 'Goodbye.' },
      },
      'menu',
    );
    const menuBuild = () =>
      build({ flows: { findByNumber: jest.fn(async () => menuFlow) } });

    it('gathers a single key, with the prompt inside the gather', async () => {
      const { runner } = menuBuild();

      const twiml = await runner.startInbound('CA1', '+1404', '+1541');

      expect(twiml).toContain('<Gather');
      expect(twiml).toContain('numDigits="1"');
      // Inside <Gather> so somebody who knows the menu can press over it.
      expect(twiml).toMatch(/<Gather[^>]*>\s*<Say>Press 1 for dispatch/);
    });

    it('follows the key the caller pressed', async () => {
      const { runner } = menuBuild();
      await runner.startInbound('CA1', '+1404', '+1541');

      expect(await runner.resume('CA1', 'menu', '2')).toContain('Goodbye.');
    });

    it('re-reads the prompt on a wrong key, then gives up gracefully', async () => {
      const { runner } = menuBuild();
      await runner.startInbound('CA1', '+1404', '+1541');

      const first = await runner.resume('CA1', 'menu', '9');
      expect(first).toContain('I did not get that');

      // repeats: 1 — the second wrong key falls through to `next` rather than
      // trapping somebody who evidently cannot use the menu.
      const second = await runner.resume('CA1', 'menu', '9');
      expect(second).toContain('<Conference');
    });

    it('sends a caller who presses nothing to the fallback step', async () => {
      const { runner } = menuBuild();
      await runner.startInbound('CA1', '+1404', '+1541');

      // No Digits at all — Twilio's <Redirect> after the gather.
      expect(await runner.resume('CA1', 'menu')).toContain('<Gather');
    });
  });

  describe('recorded greetings', () => {
    it('plays an uploaded file instead of speaking the text', async () => {
      const withAudio = flowOf(
        {
          hello: { id: 'hello', type: 'say', text: 'ignored', audioId: 'aud-1', next: 'bye' },
          bye: { id: 'bye', type: 'hangup' },
        },
        'hello',
      );
      const { runner } = build({ flows: { findByNumber: jest.fn(async () => withAudio) } });

      const twiml = await runner.startInbound('CA1', '+1404', '+1541');

      expect(twiml).toContain('<Play>https://api.test/api/telephony/voice/audio/aud-1</Play>');
      expect(twiml).not.toContain('ignored');
    });
  });

  describe('whisper', () => {
    it('asks a personal phone to prove a human is holding it — never a browser', async () => {
      const whisperFlow = flowOf(
        { ring: { id: 'ring', type: 'ring', groupId: 'g1', whisper: true } },
        'ring',
      );
      const { runner, conference } = build({
        flows: { findByNumber: jest.fn(async () => whisperFlow) },
      });

      await runner.startInbound('CA1', '+14045551234', '+15412830739');

      const legs = conference.initInbound.mock.calls[0][3] as Array<{
        endpoint: string;
        whisper?: boolean;
      }>;
      expect(legs).toEqual([
        { endpoint: 'client:u-dana', callerId: '+14045551234', whisper: false },
        { endpoint: '+14045550134', callerId: '+15412830739', whisper: true },
      ]);
    });
  });
});

describe('FlowRunnerService — what happens after the conversation', () => {
  const closing = flowOf(
    {
      ring: { id: 'ring', type: 'ring', groupId: 'g1', answeredNext: 'bye', next: 'vm' },
      bye: { id: 'bye', type: 'say', text: 'Thanks for calling.' },
      vm: { id: 'vm', type: 'voicemail', prompt: 'Leave a message.', maxSeconds: 60 },
    },
    'ring',
  );

  it('gives the Dial somewhere to go when the call ends', async () => {
    const { runner } = build({ flows: { findByNumber: jest.fn(async () => closing) } });

    const twiml = await runner.startInbound('CA1', '+1404', '+1541');

    // Without an action the TwiML ends with the <Dial>, so the caller is hung
    // up on the instant the conference closes — no closing message, nothing.
    expect(twiml).toContain('/voice/flow?node=bye&amp;after=1"');
  });

  it('keeps the closing message apart from the no-answer path', async () => {
    const { runner, conference } = build({
      flows: { findByNumber: jest.fn(async () => closing) },
    });

    await runner.startInbound('CA1', '+1404', '+1541');

    // Nobody answering leads to voicemail, not to the closing message.
    const options = conference.initInbound.mock.calls[0][4] as { noAnswerUrl?: string };
    expect(options.noAnswerUrl).toContain('node=vm');
  });

  it('omits the action when nothing follows the conversation', async () => {
    const bare = flowOf({ ring: { id: 'ring', type: 'ring', groupId: 'g1' } }, 'ring');
    const { runner } = build({ flows: { findByNumber: jest.fn(async () => bare) } });

    const twiml = await runner.startInbound('CA1', '+1404', '+1541');

    expect(twiml).not.toContain('action=');
  });

  it('records where the caller went, so the log can show it', async () => {
    const { runner, calls } = build({
      flows: { findByNumber: jest.fn(async () => closing) },
    });

    await runner.startInbound('CA1', '+1404', '+1541');
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.recordFlowStep).toHaveBeenCalledWith(
      'CA1',
      expect.objectContaining({ nodeId: 'ring', type: 'ring' }),
    );
  });
});

describe('FlowRunnerService — a caller who has already gone', () => {
  const withClosing = flowOf(
    {
      ring: { id: 'ring', type: 'ring', groupId: 'g1', answeredNext: 'bye' },
      bye: { id: 'bye', type: 'say', text: 'Thank you for calling us.' },
    },
    'ring',
  );

  it('plays nothing, and records nothing, once the call has ended', async () => {
    const { runner, calls } = build({
      flows: { findByNumber: jest.fn(async () => withClosing) },
    });
    await runner.startInbound('CA1', '+1404', '+1541');
    calls.recordFlowStep.mockClear();

    // Twilio requests a <Dial action> even when the caller is the one who hung
    // up — the TwiML is discarded, so running the step would log a greeting
    // nobody could have heard.
    const twiml = await runner.resume('CA1', 'bye', undefined, 'completed');

    expect(twiml).toBe('<Response/>');
    expect(twiml).not.toContain('Thank you for calling');
    expect(calls.recordFlowStep).not.toHaveBeenCalled();
  });

  it.each(['busy', 'no-answer', 'failed', 'canceled'])(
    'treats %s the same way',
    async (status) => {
      const { runner, calls } = build({
        flows: { findByNumber: jest.fn(async () => withClosing) },
      });
      await runner.startInbound('CA1', '+1404', '+1541');
      calls.recordFlowStep.mockClear();

      await runner.resume('CA1', 'bye', undefined, status);
      expect(calls.recordFlowStep).not.toHaveBeenCalled();
    },
  );

  it('still plays the closing message to a caller who is on the line', async () => {
    const { runner, calls } = build({
      flows: { findByNumber: jest.fn(async () => withClosing) },
    });
    await runner.startInbound('CA1', '+1404', '+1541');
    calls.recordFlowStep.mockClear();

    // The agent hung up; the caller is still connected.
    const twiml = await runner.resume('CA1', 'bye', undefined, 'in-progress');

    expect(twiml).toContain('Thank you for calling us.');
    expect(calls.recordFlowStep).toHaveBeenCalledWith(
      'CA1',
      expect.objectContaining({ nodeId: 'bye' }),
    );
  });
});

describe('FlowRunnerService — "after the call" means after a call', () => {
  const closing = flowOf(
    {
      ring: { id: 'ring', type: 'ring', groupId: 'g1', answeredNext: 'bye', next: 'second' },
      bye: { id: 'bye', type: 'say', text: 'Thank you for calling us.' },
      second: { id: 'second', type: 'ring', groupId: 'g2' },
    },
    'ring',
  );

  it('marks the closing step so it can tell itself apart', async () => {
    const { runner } = build({ flows: { findByNumber: jest.fn(async () => closing) } });

    const twiml = await runner.startInbound('CA1', '+1404', '+1541');

    expect(twiml).toContain('node=bye&amp;after=1');
  });

  it('says nothing when the dial ended without anybody answering', async () => {
    const { runner, calls } = build({
      flows: { findByNumber: jest.fn(async () => closing) },
      calls: { getBySid: jest.fn(async () => ({ answeredAt: undefined })) },
    });
    await runner.startInbound('CA1', '+1404', '+1541');
    calls.recordFlowStep.mockClear();

    // The first group timed out and the flow is moving to the second — a
    // thank-you here would be played to somebody nobody spoke to.
    const twiml = await runner.resume('CA1', 'bye', undefined, 'in-progress', true);

    expect(twiml).toBe('<Response/>');
    expect(calls.recordFlowStep).not.toHaveBeenCalled();
  });

  it('says it when there really was a conversation', async () => {
    const { runner } = build({ flows: { findByNumber: jest.fn(async () => closing) } });
    await runner.startInbound('CA1', '+1404', '+1541');

    const twiml = await runner.resume('CA1', 'bye', undefined, 'in-progress', true);

    expect(twiml).toContain('Thank you for calling us.');
  });
});
