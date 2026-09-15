import { TWILIO_CONFIG, TwilioSignatureGuard, TwilioRest } from '@bitcrm/shared';
import {
  TELEPHONY_CONFIG,
  loadTelephonyConfig,
  type TelephonyConfig,
} from '../../src/telephony/telephony.config';
import { TwilioSignatureGuard as ShimmedGuard } from '../../src/common/twilio-signature.guard';
import { TwilioRest as ShimmedRest } from '../../src/common/twilio-client';

/**
 * The Twilio primitives moved to @bitcrm/shared. What must NOT have changed
 * for telephony: the config values it loads, the token it provides them
 * under, and the classes its old import paths resolve to.
 */
const ENV = {
  TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
  TWILIO_AUTH_TOKEN: 'the-auth-token',
  TWILIO_API_KEY: 'SK00000000000000000000000000000000',
  TWILIO_API_SECRET: 'the-api-secret',
  TWILIO_TWIML_APP_SID: 'AP00000000000000000000000000000000',
  TWILIO_CALLER_ID: '+12624061115',
  TELEPHONY_DEFAULT_AREA_CALLER_ID: '+14045550100',
  PUBLIC_BASE_URL: 'https://example.ngrok-free.dev',
  TWILIO_TOKEN_TTL_SECONDS: '1800',
  TWILIO_VALIDATE_SIGNATURE: 'false',
};

const KEYS = [...Object.keys(ENV), 'TWILIO_MESSAGING_SERVICE_SID'];

describe('telephony.config (on the shared Twilio config)', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('loads exactly the values it always did', () => {
    Object.assign(process.env, ENV);

    const expected: TelephonyConfig = {
      accountSid: ENV.TWILIO_ACCOUNT_SID,
      authToken: ENV.TWILIO_AUTH_TOKEN,
      apiKey: ENV.TWILIO_API_KEY,
      apiSecret: ENV.TWILIO_API_SECRET,
      twimlAppSid: ENV.TWILIO_TWIML_APP_SID,
      callerId: ENV.TWILIO_CALLER_ID,
      defaultAreaCallerId: ENV.TELEPHONY_DEFAULT_AREA_CALLER_ID,
      publicBaseUrl: ENV.PUBLIC_BASE_URL,
      tokenTtlSeconds: 1800,
      validateSignature: false,
    };
    expect(loadTelephonyConfig()).toEqual(expected);
  });

  it('keeps the old defaults when nothing is set', () => {
    expect(loadTelephonyConfig()).toEqual({
      accountSid: '',
      authToken: '',
      apiKey: '',
      apiSecret: '',
      twimlAppSid: '',
      callerId: '',
      defaultAreaCallerId: '',
      publicBaseUrl: '',
      tokenTtlSeconds: 3600,
      validateSignature: true,
    });
  });

  it('picks up the Messaging Service sid when one is configured', () => {
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG00000000000000000000000000000000';
    expect(loadTelephonyConfig().messagingServiceSid).toBe(
      'MG00000000000000000000000000000000',
    );
  });

  it('provides its config under the token the shared guard injects', () => {
    expect(TELEPHONY_CONFIG).toBe(TWILIO_CONFIG);
  });

  it('resolves the old import paths to the shared classes', () => {
    expect(ShimmedGuard).toBe(TwilioSignatureGuard);
    expect(ShimmedRest).toBe(TwilioRest);
  });
});
