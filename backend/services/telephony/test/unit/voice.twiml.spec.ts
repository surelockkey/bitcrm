import { VoiceService } from '../../src/voice/voice.service';
import { type TelephonyConfig } from '../../src/telephony/telephony.config';
import { PresenceService } from '../../src/presence/presence.service';
import { ConferenceService } from '../../src/voice/conference.service';

export const CONFIG: TelephonyConfig = {
  accountSid: 'AC00000000000000000000000000000000',
  authToken: 'the-auth-token',
  apiKey: 'SK00000000000000000000000000000000',
  apiSecret: 'the-api-secret',
  twimlAppSid: 'AP00000000000000000000000000000000',
  callerId: '+12624061115',
  // No per-market default in tests: the market chain falls straight
  // through to callerId, which is what the pre-masking behaviour was.
  defaultAreaCallerId: '',
  publicBaseUrl: 'https://example.ngrok-free.dev',
  tokenTtlSeconds: 3600,
  validateSignature: true,
};

const BASE = 'https://example.ngrok-free.dev/api/telephony';

function makeService(opts: {
  online?: string[];
  conference?: Partial<Record<keyof ConferenceService, unknown>>;
  technicianLine?: string | null;
} = {}) {
  const presence = {
    listOnline: jest.fn().mockResolvedValue(opts.online ?? []),
  } as unknown as PresenceService;
  const conference = {
    initOutbound: jest.fn().mockResolvedValue(undefined),
    initInbound: jest.fn().mockResolvedValue(undefined),
    claimWinner: jest.fn().mockResolvedValue('winner'),
    onWinner: jest.fn().mockResolvedValue(undefined),
    consumeMonitorGrant: jest.fn().mockResolvedValue(null),
    conferenceSidOf: jest.fn().mockResolvedValue('CF123'),
    isConferenceLive: jest.fn().mockResolvedValue(true),
    recordMonitorParticipant: jest.fn().mockResolvedValue(undefined),
    findLinkedOutbound: jest.fn().mockResolvedValue(undefined),
    // Conference lifecycle/recording attributes now live on the conference
    // service, so every <Conference> we emit agrees on them.
    sharedConferenceAttrs: jest.fn(() => ({
      statusCallback: `${BASE}/voice/conference-events`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['start', 'end', 'join', 'leave'],
      record: 'record-from-start',
      recordingStatusCallback: `${BASE}/voice/recording-status`,
      recordingStatusCallbackMethod: 'POST',
    })),
    ...opts.conference,
  } as unknown as ConferenceService;
  const flowRunner = {
    startInbound: jest.fn(async () => null),
    startTechnicianLine: jest.fn(async () => '<Response>dial-in</Response>'),
  };
  const settings = {
    technicianLine: jest.fn(async () => opts.technicianLine ?? null),
  };
  return {
    // A number with no flow: the runner declines and the legacy path answers,
    // which is exactly what these cases exercise.
    service: new VoiceService(
      CONFIG,
      presence,
      conference,
      flowRunner as never,
      undefined,
      undefined,
      settings as never,
    ),
    conference,
    presence,
    flowRunner,
    settings,
  };
}

/** Every <Conference> we emit must carry the same lifecycle+recording attrs
 *  (Twilio takes them from whichever participant creates the conference). */
function expectSharedConferenceAttrs(xml: string) {
  expect(xml).toContain(`statusCallback="${BASE}/voice/conference-events"`);
  expect(xml).toContain('statusCallbackEvent="start end join leave"');
  expect(xml).toContain('record="record-from-start"');
  expect(xml).toContain(`recordingStatusCallback="${BASE}/voice/recording-status"`);
}

describe('VoiceService.buildOutbound — agent leg TwiML', () => {
  it('puts the agent into the per-call conference, owning its lifecycle', async () => {
    const { service, conference } = makeService();
    const xml = await service.buildOutbound({
      CallSid: 'CAagent1',
      From: 'client:agent-1',
      To: '+14045551234',
      CallerId: '+12624061115',
    });

    expect(xml).toContain('<Dial>');
    expect(xml).toContain('<Conference');
    expect(xml).toContain('conf-CAagent1</Conference>');
    expect(xml).toContain('startConferenceOnEnter="true"');
    expect(xml).toContain('endConferenceOnExit="true"');
    expect(xml).toContain('beep="false"');
    expectSharedConferenceAttrs(xml);

    expect(conference.initOutbound).toHaveBeenCalledWith(
      'CAagent1',
      'agent-1',
      '+14045551234',
      '+12624061115',
    );
  });

  it('says an error and hangs up when no destination is given', async () => {
    const { service, conference } = makeService();
    const xml = await service.buildOutbound({
      CallSid: 'CAagent1',
      From: 'client:agent-1',
    });
    expect(xml).toContain('<Say>');
    expect(xml).toContain('<Hangup');
    expect(xml).not.toContain('<Conference');
    expect(conference.initOutbound).not.toHaveBeenCalled();
  });
});

describe('VoiceService.buildOutbound — Monitor branch', () => {
  it('joins a live conference muted for listen mode', async () => {
    const { service } = makeService({
      conference: { consumeMonitorGrant: jest.fn().mockResolvedValue('listen') },
    });
    const xml = await service.buildOutbound({
      CallSid: 'CAsup1',
      From: 'client:supervisor-1',
      Monitor: 'conf-CAagent1',
    });

    expect(xml).toContain('muted="true"');
    expect(xml).toContain('beep="false"');
    expect(xml).toContain('startConferenceOnEnter="false"');
    expect(xml).toContain('endConferenceOnExit="false"');
    expect(xml).toContain('conf-CAagent1</Conference>');
  });

  it('joins unmuted for join mode', async () => {
    const { service } = makeService({
      conference: { consumeMonitorGrant: jest.fn().mockResolvedValue('join') },
    });
    const xml = await service.buildOutbound({
      CallSid: 'CAsup1',
      From: 'client:supervisor-1',
      Monitor: 'conf-CAagent1',
    });
    expect(xml).toContain('muted="false"');
  });

  it('rejects a monitor attempt without a grant', async () => {
    const { service } = makeService(); // grant resolves null
    const xml = await service.buildOutbound({
      CallSid: 'CAsup1',
      From: 'client:supervisor-1',
      Monitor: 'conf-CAagent1',
    });
    expect(xml).toContain('<Say>');
    expect(xml).toContain('<Hangup');
    expect(xml).not.toContain('<Conference');
  });

  it('reports a call that already ended instead of opening a dead conference', async () => {
    const { service } = makeService({
      conference: {
        consumeMonitorGrant: jest.fn().mockResolvedValue('listen'),
        isConferenceLive: jest.fn().mockResolvedValue(false),
      },
    });
    const xml = await service.buildOutbound({
      CallSid: 'CAsup1',
      From: 'client:supervisor-1',
      Monitor: 'conf-CAagent1',
    });
    expect(xml).toContain('already ended');
    expect(xml).toContain('<Hangup');
    expect(xml).not.toContain('<Conference');
  });
});

describe('VoiceService.buildInbound — customer leg TwiML', () => {
  it('parks the customer in the conference on hold until an agent joins', async () => {
    const { service, conference } = makeService({ online: ['agent-1', 'agent-2'] });
    const xml = await service.buildInbound({
      CallSid: 'CAcust1',
      From: '+380958601427',
      To: '+12624061115',
    });

    expect(xml).toContain('conf-CAcust1</Conference>');
    expect(xml).toContain('startConferenceOnEnter="false"');
    expect(xml).toContain('endConferenceOnExit="true"');
    expectSharedConferenceAttrs(xml);
    expect(conference.initInbound).toHaveBeenCalledWith(
      'CAcust1',
      '+380958601427',
      '+12624061115',
      // Each softphone is rung showing the customer's number, so it screen-pops.
      [
        { endpoint: 'client:agent-1', callerId: '+380958601427' },
        { endpoint: 'client:agent-2', callerId: '+380958601427' },
      ],
      { internalLegOf: undefined }, // not an internal call
    );
  });

  it('plays the unavailable message when nobody is online', async () => {
    const { service, conference } = makeService({ online: [] });
    const xml = await service.buildInbound({
      CallSid: 'CAcust1',
      From: '+380958601427',
      To: '+12624061115',
    });
    expect(xml).toContain('no agents are available');
    expect(xml).toContain('<Hangup');
    expect(conference.initInbound).not.toHaveBeenCalled();
  });
});

describe('VoiceService.buildAgentJoin — first-answer-wins', () => {
  it('sends the winner into the conference (starting it)', async () => {
    const { service, conference } = makeService({
      conference: { claimWinner: jest.fn().mockResolvedValue('winner') },
    });
    const xml = await service.buildAgentJoin('conf-CAcust1', {
      CallSid: 'CAleg1',
      To: 'client:agent-1',
    });

    expect(xml).toContain('conf-CAcust1</Conference>');
    expect(xml).toContain('startConferenceOnEnter="true"');
    expect(xml).toContain('endConferenceOnExit="true"');
    expect(xml).toContain('beep="false"');
    expectSharedConferenceAttrs(xml);
    expect(conference.onWinner).toHaveBeenCalledWith(
      'conf-CAcust1',
      'CAleg1',
      'agent-1',
    );
  });

  it('tells a late answerer the call was taken and hangs up', async () => {
    const { service, conference } = makeService({
      conference: { claimWinner: jest.fn().mockResolvedValue('loser') },
    });
    const xml = await service.buildAgentJoin('conf-CAcust1', {
      CallSid: 'CAleg2',
      To: 'client:agent-2',
    });
    expect(xml).toContain('answered by another agent');
    expect(xml).toContain('<Hangup');
    expect(xml).not.toContain('<Conference');
    expect(conference.onWinner).not.toHaveBeenCalled();
  });
});

/**
 * The technician line is the one number where the ring-everyone fallback is
 * WRONG: the caller has not said who they are yet, so answering by ringing
 * every online softphone is the opposite of what the line is for.
 */
describe('VoiceService.buildInbound — the technician line', () => {
  const TECH_LINE = '+14098777774';

  it('runs the dial-in with no flow configured at all', async () => {
    const { service, flowRunner } = makeService({
      technicianLine: TECH_LINE,
      online: ['agent-1'],
    });

    const xml = await service.buildInbound({
      CallSid: 'CAtech',
      From: '+14045550134',
      To: TECH_LINE,
    });

    expect(flowRunner.startTechnicianLine).toHaveBeenCalledWith(
      'CAtech',
      '+14045550134',
      TECH_LINE,
    );
    expect(xml).toBe('<Response>dial-in</Response>');
  });

  it('never rings the whole workspace for an unidentified caller', async () => {
    const { service, conference } = makeService({
      technicianLine: TECH_LINE,
      online: ['agent-1', 'agent-2'],
    });

    await service.buildInbound({
      CallSid: 'CAtech',
      From: '+14045550134',
      To: TECH_LINE,
    });

    expect(conference.initInbound).not.toHaveBeenCalled();
  });

  /** A flow attached to the line still wins — that is how a workspace adds a
   *  greeting or after-hours handling on top of the built-in behaviour. */
  it('lets a real flow on that number take precedence', async () => {
    const { service, flowRunner } = makeService({ technicianLine: TECH_LINE });
    flowRunner.startInbound.mockResolvedValue('<Response>from flow</Response>' as never);

    const xml = await service.buildInbound({
      CallSid: 'CAtech',
      From: '+14045550134',
      To: TECH_LINE,
    });

    expect(xml).toBe('<Response>from flow</Response>');
    expect(flowRunner.startTechnicianLine).not.toHaveBeenCalled();
  });

  it('leaves every other number on the ordinary path', async () => {
    const { service, flowRunner } = makeService({
      technicianLine: TECH_LINE,
      online: ['agent-1'],
    });

    await service.buildInbound({
      CallSid: 'CAmain',
      From: '+14045550134',
      To: '+15412830739',
    });

    expect(flowRunner.startTechnicianLine).not.toHaveBeenCalled();
  });
});
