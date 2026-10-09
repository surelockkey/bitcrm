import { VoiceService } from '../../src/voice/voice.service';
import { type TelephonyConfig } from '../../src/telephony/telephony.config';

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
 * A number with no usable flow rings everyone online; when nobody is, the
 * account's fallback number is the last resort before the apology — Workiz's
 * "if for some reason the call flow fails, calls will be forwarded to this
 * number".
 */
function makeService(opts: { online?: string[]; fallback?: string | null } = {}) {
  const presence = { listOnline: jest.fn().mockResolvedValue(opts.online ?? []) };
  const conference = {
    initInbound: jest.fn().mockResolvedValue(undefined),
    findLinkedOutbound: jest.fn().mockResolvedValue(undefined),
    sharedConferenceAttrs: jest.fn(() => ({ record: 'record-from-start' })),
  };
  const flowRunner = { startInbound: jest.fn(async () => null) };
  const settings = {
    technicianLine: jest.fn(async () => null),
    fallbackNumber: jest.fn(async () => opts.fallback ?? null),
  };
  const service = new VoiceService(CONFIG, presence as never, conference as never, flowRunner as never, undefined, undefined, settings as never);
  return { service, conference };
}

describe('VoiceService — the fallback number when nobody is online', () => {
  it('rings the fallback number from our number and parks the caller in the conference', async () => {
    const { service, conference } = makeService({ fallback: '+15550001111' });

    const twiml = await service.buildInbound({ CallSid: 'CA1', From: '+14045551234', To: '+15412830739' });

    expect(twiml).toContain('<Conference');
    expect(conference.initInbound).toHaveBeenCalledWith(
      'CA1',
      '+14045551234',
      '+15412830739',
      [{ endpoint: '+15550001111', callerId: '+15412830739', whisper: false }],
      { ringSeconds: 60 },
    );
  });

  it('apologises as before when there is no fallback number', async () => {
    const { service, conference } = makeService();
    const twiml = await service.buildInbound({ CallSid: 'CA1', From: '+14045551234', To: '+15412830739' });
    expect(twiml).toContain('no agents are available');
    expect(conference.initInbound).not.toHaveBeenCalled();
  });

  it('is not used while somebody is online — they are rung as before', async () => {
    const { service, conference } = makeService({ online: ['u-dana'], fallback: '+15550001111' });
    await service.buildInbound({ CallSid: 'CA1', From: '+14045551234', To: '+15412830739' });
    const [, , , legs] = conference.initInbound.mock.calls[0] as unknown[];
    expect(legs).toEqual([{ endpoint: 'client:u-dana', callerId: '+14045551234' }]);
  });
});
