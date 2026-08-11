import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import twilio from 'twilio';
import { TELEPHONY_CONFIG, type TelephonyConfig } from './telephony.config';

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

export interface VoiceTokenResult {
  /** Signed Twilio AccessToken JWT for the browser Voice SDK. */
  token: string;
  /** The client identity the token is scoped to (the agent's user id). */
  identity: string;
  /** Epoch seconds at which the token expires. */
  expiresAt: number;
}

@Injectable()
export class TelephonyService {
  constructor(
    @Inject(TELEPHONY_CONFIG) private readonly config: TelephonyConfig,
  ) {}

  /**
   * Mint a short-lived Twilio Voice access token for a browser softphone.
   * The token grants outgoing calls through our TwiML App and allows incoming
   * calls addressed to `<Client>{identity}</Client>`.
   */
  generateAccessToken(identity: string): VoiceTokenResult {
    const { accountSid, apiKey, apiSecret, twimlAppSid, tokenTtlSeconds } =
      this.config;

    if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) {
      throw new InternalServerErrorException(
        'Twilio voice is not configured (missing TWILIO_ACCOUNT_SID / API key / TwiML App SID)',
      );
    }

    const token = new AccessToken(accountSid, apiKey, apiSecret, {
      identity,
      ttl: tokenTtlSeconds,
    });

    token.addGrant(
      new VoiceGrant({
        outgoingApplicationSid: twimlAppSid,
        incomingAllow: true,
      }),
    );

    return {
      token: token.toJwt(),
      identity,
      expiresAt: Math.floor(Date.now() / 1000) + tokenTtlSeconds,
    };
  }
}
