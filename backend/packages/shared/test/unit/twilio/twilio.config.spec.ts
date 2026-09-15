import {
  TWILIO_CONFIG,
  TWILIO_ENV_VARS,
  loadTwilioConfig,
} from '../../../src/twilio/twilio.config';

describe('loadTwilioConfig', () => {
  it('reads the account credentials and public URL from the environment', () => {
    const config = loadTwilioConfig({
      TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
      TWILIO_AUTH_TOKEN: 'the-auth-token',
      PUBLIC_BASE_URL: 'https://api.example.test',
    });

    expect(config).toEqual({
      accountSid: 'AC00000000000000000000000000000000',
      authToken: 'the-auth-token',
      publicBaseUrl: 'https://api.example.test',
      validateSignature: true,
    });
  });

  it('defaults every string to empty rather than undefined', () => {
    const config = loadTwilioConfig({});
    expect(config.accountSid).toBe('');
    expect(config.authToken).toBe('');
    expect(config.publicBaseUrl).toBe('');
  });

  it('validates signatures unless explicitly switched off with the string "false"', () => {
    expect(loadTwilioConfig({}).validateSignature).toBe(true);
    expect(loadTwilioConfig({ TWILIO_VALIDATE_SIGNATURE: 'true' }).validateSignature).toBe(true);
    expect(loadTwilioConfig({ TWILIO_VALIDATE_SIGNATURE: '0' }).validateSignature).toBe(true);
    expect(loadTwilioConfig({ TWILIO_VALIDATE_SIGNATURE: 'false' }).validateSignature).toBe(false);
  });

  it('exposes the Messaging Service sid only when one is configured', () => {
    expect(loadTwilioConfig({})).not.toHaveProperty('messagingServiceSid');
    expect(loadTwilioConfig({ TWILIO_MESSAGING_SERVICE_SID: '' })).not.toHaveProperty(
      'messagingServiceSid',
    );
    expect(
      loadTwilioConfig({ TWILIO_MESSAGING_SERVICE_SID: 'MG00000000000000000000000000000000' })
        .messagingServiceSid,
    ).toBe('MG00000000000000000000000000000000');
  });

  it('reads process.env by default', () => {
    const before = process.env.TWILIO_ACCOUNT_SID;
    process.env.TWILIO_ACCOUNT_SID = 'ACfromprocess';
    try {
      expect(loadTwilioConfig().accountSid).toBe('ACfromprocess');
    } finally {
      if (before === undefined) delete process.env.TWILIO_ACCOUNT_SID;
      else process.env.TWILIO_ACCOUNT_SID = before;
    }
  });

  it('documents every variable it reads', () => {
    expect([...TWILIO_ENV_VARS].sort()).toEqual(
      [
        'PUBLIC_BASE_URL',
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_MESSAGING_SERVICE_SID',
        'TWILIO_VALIDATE_SIGNATURE',
      ].sort(),
    );
  });

  it('uses a symbol token so two services cannot collide on a string', () => {
    expect(typeof TWILIO_CONFIG).toBe('symbol');
  });
});
