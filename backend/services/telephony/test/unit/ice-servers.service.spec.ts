import {
  IceServersService,
  type IceServerSource,
} from '../../src/telephony/ice-servers.service';
import { type TelephonyConfig } from '../../src/telephony/telephony.config';

const CONFIG = {
  accountSid: 'AC00000000000000000000000000000000',
  authToken: 'the-auth-token',
} as TelephonyConfig;

/** What Twilio's Network Traversal Service hands out (Tokens API). */
const NTS = [
  { url: 'stun:global.stun.twilio.com:3478', urls: 'stun:global.stun.twilio.com:3478' },
  {
    url: 'turn:global.turn.twilio.com:3478?transport=udp',
    urls: 'turn:global.turn.twilio.com:3478?transport=udp',
    username: 'u1',
    credential: 'c1',
  },
  {
    url: 'turn:global.turn.twilio.com:443?transport=tcp',
    urls: 'turn:global.turn.twilio.com:443?transport=tcp',
    username: 'u1',
    credential: 'c1',
  },
];

const HOUR = 60 * 60 * 1000;

describe('IceServersService', () => {
  let now: number;
  let source: jest.MockedFunction<IceServerSource>;
  let service: IceServersService;

  beforeEach(() => {
    now = Date.UTC(2026, 9, 12, 12, 0, 0);
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    source = jest.fn().mockResolvedValue(NTS);
    service = new IceServersService(CONFIG, source);
  });

  afterEach(() => jest.restoreAllMocks());

  it('hands out the STUN/TURN servers Twilio issues, in the browser RTCIceServer shape', async () => {
    await expect(service.get()).resolves.toEqual([
      { urls: 'stun:global.stun.twilio.com:3478' },
      {
        urls: 'turn:global.turn.twilio.com:3478?transport=udp',
        username: 'u1',
        credential: 'c1',
      },
      {
        urls: 'turn:global.turn.twilio.com:443?transport=tcp',
        username: 'u1',
        credential: 'c1',
      },
    ]);
  });

  it('asks Twilio for credentials that live a day', async () => {
    await service.get();
    expect(source).toHaveBeenCalledWith(24 * 60 * 60);
  });

  it('reuses one set of credentials instead of asking Twilio on every token', async () => {
    await service.get();
    now += 3 * HOUR;
    await service.get();
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('fetches fresh credentials once half their life is gone, so a browser never holds dying ones', async () => {
    await service.get();
    now += 12 * HOUR + 1;
    await service.get();
    expect(source).toHaveBeenCalledTimes(2);
  });

  it('shares one request between callers that arrive together', async () => {
    await Promise.all([service.get(), service.get(), service.get()]);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('answers nothing when Twilio fails — the token must still be issued', async () => {
    source.mockRejectedValueOnce(new Error('Twilio down'));
    await expect(service.get()).resolves.toBeUndefined();
  });

  it('does not hammer Twilio after a failure, and tries again a minute later', async () => {
    source.mockRejectedValueOnce(new Error('Twilio down'));
    await service.get();
    now += 30 * 1000;
    await expect(service.get()).resolves.toBeUndefined();
    expect(source).toHaveBeenCalledTimes(1);

    now += 31 * 1000;
    await expect(service.get()).resolves.toHaveLength(3);
    expect(source).toHaveBeenCalledTimes(2);
  });

  it('keeps serving the last good credentials while they are still valid if a refresh fails', async () => {
    await service.get();
    now += 12 * HOUR + 1;
    source.mockRejectedValueOnce(new Error('Twilio down'));
    await expect(service.get()).resolves.toHaveLength(3);
  });

  it('treats an empty answer as no servers', async () => {
    source.mockResolvedValueOnce([]);
    await expect(service.get()).resolves.toBeUndefined();
  });
});
