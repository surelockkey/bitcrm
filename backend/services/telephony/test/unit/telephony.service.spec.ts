import * as jwt from 'jsonwebtoken';
import { TelephonyService } from '../../src/telephony/telephony.service';
import { type TelephonyConfig } from '../../src/telephony/telephony.config';

const CONFIG: TelephonyConfig = {
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

describe('TelephonyService.generateAccessToken', () => {
  let service: TelephonyService;

  beforeEach(() => {
    service = new TelephonyService(CONFIG);
  });

  it('mints a Voice access token scoped to the given identity', () => {
    const result = service.generateAccessToken('user-123');

    expect(result.identity).toBe('user-123');
    expect(typeof result.token).toBe('string');
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const decoded = jwt.decode(result.token) as Record<string, any>;
    // Twilio AccessToken: issuer = API key SID, subject = account SID.
    expect(decoded.iss).toBe(CONFIG.apiKey);
    expect(decoded.sub).toBe(CONFIG.accountSid);
    // The identity and voice grant live under `grants`.
    expect(decoded.grants.identity).toBe('user-123');
    expect(decoded.grants.voice.outgoing.application_sid).toBe(
      CONFIG.twimlAppSid,
    );
    expect(decoded.grants.voice.incoming.allow).toBe(true);
  });

  it('signs the token with the API secret', () => {
    const result = service.generateAccessToken('user-123');
    // Verifies signature — throws if signed with the wrong key.
    expect(() => jwt.verify(result.token, CONFIG.apiSecret)).not.toThrow();
    expect(() => jwt.verify(result.token, 'wrong-secret')).toThrow();
  });

  it('throws when Twilio is not configured', () => {
    const unconfigured = new TelephonyService({ ...CONFIG, apiKey: '' });
    expect(() => unconfigured.generateAccessToken('user-123')).toThrow(
      /not configured/i,
    );
  });
});
