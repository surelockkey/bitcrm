import { TelephonyController } from '../../src/telephony/telephony.controller';
import { type JwtUser } from '@bitcrm/types';

const USER = { id: 'user-123' } as JwtUser;
const TOKEN = { token: 'jwt', identity: 'user-123', expiresAt: 1 };
const ICE = [
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'turn:global.turn.twilio.com:443?transport=tcp', username: 'u', credential: 'c' },
];

function controller(iceServers: unknown) {
  const telephony = { generateAccessToken: jest.fn().mockReturnValue(TOKEN) };
  const ice = { get: jest.fn().mockResolvedValue(iceServers) };
  return new TelephonyController(
    telephony as never,
    {} as never,
    {} as never,
    ice as never,
  );
}

describe('POST /telephony/token', () => {
  it('sends the STUN/TURN servers with the token, so a browser that cannot reach Twilio directly still gets audio', async () => {
    await expect(controller(ICE).token(USER)).resolves.toEqual({
      success: true,
      data: { ...TOKEN, iceServers: ICE },
    });
  });

  it('still issues the token when there are no servers to send', async () => {
    await expect(controller(undefined).token(USER)).resolves.toEqual({
      success: true,
      data: TOKEN,
    });
  });
});
