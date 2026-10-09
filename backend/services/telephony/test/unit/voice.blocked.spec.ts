import { VoiceService } from '../../src/voice/voice.service';
import { type TelephonyConfig } from '../../src/telephony/telephony.config';
import { PresenceService } from '../../src/presence/presence.service';
import { ConferenceService } from '../../src/voice/conference.service';
import { CallsService } from '../../src/calls/calls.service';
import { BlockedCallersService } from '../../src/blocked-callers/blocked-callers.service';

const CONFIG: TelephonyConfig = {
  accountSid: 'AC00000000000000000000000000000000',
  authToken: 'the-auth-token',
  apiKey: 'SK00000000000000000000000000000000',
  apiSecret: 'the-api-secret',
  twimlAppSid: 'AP00000000000000000000000000000000',
  callerId: '+12624061115',
  defaultAreaCallerId: '',
  publicBaseUrl: 'https://example.ngrok-free.dev',
  tokenTtlSeconds: 3600,
  validateSignature: true,
};

/**
 * A blocked caller (Workiz Phone → Blocked callers) is turned away before the
 * flow, the technician line or the legacy ring ever see the call: Twilio gets
 * `<Reject/>` (no billing, "not in service" to the caller), and the log gets a
 * row with status `blocked` so the block is visible — Workiz's own log hides
 * these calls entirely.
 */
function make(opts: { blocked?: boolean; checkThrows?: boolean; withCalls?: boolean } = {}) {
  const presence = { listOnline: jest.fn().mockResolvedValue(['agent-1']) } as unknown as PresenceService;
  const conference = {
    initInbound: jest.fn().mockResolvedValue(undefined),
    findLinkedOutbound: jest.fn().mockResolvedValue(undefined),
    sharedConferenceAttrs: jest.fn(() => ({})),
  } as unknown as ConferenceService;
  const flowRunner = {
    startInbound: jest.fn(async () => '<Response><Say>flow</Say></Response>'),
    startTechnicianLine: jest.fn(async () => '<Response>dial-in</Response>'),
  };
  const settings = { technicianLine: jest.fn(async () => null) };
  const blocked = {
    isBlocked: opts.checkThrows
      ? jest.fn().mockRejectedValue(new Error('boom'))
      : jest.fn().mockResolvedValue(!!opts.blocked),
  };
  const calls = { applyLifecycle: jest.fn().mockResolvedValue(undefined) };
  const service = new VoiceService(
    CONFIG,
    presence,
    conference,
    flowRunner as never,
    undefined,
    undefined,
    settings as never,
    blocked as unknown as BlockedCallersService,
    opts.withCalls === false ? undefined : (calls as unknown as CallsService),
  );
  return { service, flowRunner, blocked, calls, conference };
}

describe('VoiceService.buildInbound — a blocked caller', () => {
  const body = { CallSid: 'CAspam1', From: '+12147917112', To: '+12624061115' };

  it('rejects the call before any flow runs and logs it as blocked', async () => {
    const { service, flowRunner, calls, conference } = make({ blocked: true });

    const xml = await service.buildInbound(body, '2026-10-09T12:00:00.000Z');

    expect(xml).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
    expect(flowRunner.startInbound).not.toHaveBeenCalled();
    expect(conference.initInbound).not.toHaveBeenCalled();
    expect(calls.applyLifecycle).toHaveBeenCalledWith({
      callSid: 'CAspam1',
      direction: 'inbound',
      from: '+12147917112',
      to: '+12624061115',
      status: 'blocked',
      startedAt: '2026-10-09T12:00:00.000Z',
      endedAt: '2026-10-09T12:00:00.000Z',
    });
  });

  it('asks the list about the caller and lets everyone else through to the flow', async () => {
    const { service, flowRunner, blocked, calls } = make({ blocked: false });
    const xml = await service.buildInbound(body);
    expect(blocked.isBlocked).toHaveBeenCalledWith('+12147917112');
    expect(xml).toContain('<Say>flow</Say>');
    expect(flowRunner.startInbound).toHaveBeenCalledWith('CAspam1', '+12147917112', '+12624061115');
    expect(calls.applyLifecycle).not.toHaveBeenCalled();
  });

  it('still rejects when the log row cannot be written', async () => {
    const { service, calls } = make({ blocked: true });
    calls.applyLifecycle.mockRejectedValueOnce(new Error('dynamo down'));
    const xml = await service.buildInbound(body);
    expect(xml).toContain('<Reject/>');
  });

  it('rejects without a log writer at all', async () => {
    const { service } = make({ blocked: true, withCalls: false });
    expect(await service.buildInbound(body)).toContain('<Reject/>');
  });

  it('never lets a broken check take the line down: the call goes on as usual', async () => {
    const { service, flowRunner } = make({ checkThrows: true });
    const xml = await service.buildInbound(body);
    expect(xml).toContain('<Say>flow</Say>');
    expect(flowRunner.startInbound).toHaveBeenCalled();
  });

  it('does nothing for a webhook without a CallSid', async () => {
    const { service, blocked } = make({ blocked: true });
    const xml = await service.buildInbound({ From: '+12147917112', To: '+12624061115' });
    expect(blocked.isBlocked).not.toHaveBeenCalled();
    expect(xml).toContain('no agents are available');
  });
});
