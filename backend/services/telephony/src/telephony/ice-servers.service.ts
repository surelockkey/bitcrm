import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { TwilioRest } from '@bitcrm/shared';
import { TELEPHONY_CONFIG, type TelephonyConfig } from './telephony.config';

/** One STUN/TURN server, in the browser's `RTCIceServer` shape. */
export interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

/** Twilio's answer, as the Tokens API returns it (`url` is the deprecated twin of `urls`). */
interface NtsIceServer {
  urls?: string;
  url?: string;
  username?: string;
  credential?: string;
}

/** Asks Twilio's Network Traversal Service for servers that live `ttlSeconds`. */
export type IceServerSource = (ttlSeconds: number) => Promise<NtsIceServer[]>;

export const ICE_SERVER_SOURCE = Symbol('ICE_SERVER_SOURCE');

/** The longest Twilio issues, so one set serves a whole working day. */
const NTS_TTL_SECONDS = 24 * 60 * 60;
/**
 * Handed out for half their life: a browser keeps the set it got with its
 * voice token for that token's hour, so whatever it holds always has hours
 * left on it.
 */
const SERVE_FOR_MS = (NTS_TTL_SECONDS * 1000) / 2;
/** After a failed ask, how long the token goes out without servers before asking again. */
const RETRY_AFTER_MS = 60 * 1000;

/**
 * STUN/TURN servers for the browser softphone (Twilio Network Traversal
 * Service).
 *
 * Without them a call's audio only flows when the browser can reach Twilio's
 * media servers straight over UDP. Where it can't — a WebRTC-restricting
 * extension, a VPN, a strict network — the browser gathers no usable
 * candidates, the call connects in silence both ways, and the SDK's ICE
 * restarts hammer the signaling socket until Twilio rate-limits it (31206)
 * and closes it (31009). TURN over TCP/443 gets audio through all of those.
 *
 * Never fatal: a token goes out without servers when Twilio can't be asked,
 * which is exactly how every call worked before.
 */
@Injectable()
export class IceServersService {
  private readonly logger = new Logger(IceServersService.name);
  private readonly source: IceServerSource;
  private cached: { servers: IceServer[]; fetchedAt: number } | null = null;
  private failedAt = 0;
  private inflight: Promise<IceServer[] | undefined> | null = null;

  constructor(
    @Inject(TELEPHONY_CONFIG) config: TelephonyConfig,
    @Optional() @Inject(ICE_SERVER_SOURCE) source?: IceServerSource,
  ) {
    this.source =
      source ??
      ((ttl) =>
        new TwilioRest(config).run(async (c) => (await c.tokens.create({ ttl })).iceServers));
  }

  async get(): Promise<IceServer[] | undefined> {
    const now = Date.now();
    if (this.cached && now - this.cached.fetchedAt < SERVE_FOR_MS) {
      return this.cached.servers;
    }
    if (now - this.failedAt < RETRY_AFTER_MS) return this.stillValid(now);
    this.inflight ??= this.fetch().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetch(): Promise<IceServer[] | undefined> {
    try {
      const servers = toIceServers(await this.source(NTS_TTL_SECONDS));
      if (servers.length === 0) return this.stillValid(Date.now());
      this.cached = { servers, fetchedAt: Date.now() };
      return servers;
    } catch (error) {
      this.failedAt = Date.now();
      this.logger.warn(
        `Could not get TURN servers from Twilio: ${error instanceof Error ? error.message : error}`,
      );
      return this.stillValid(this.failedAt);
    }
  }

  /** The last good set, while Twilio still honours it. */
  private stillValid(now: number): IceServer[] | undefined {
    if (this.cached && now - this.cached.fetchedAt < NTS_TTL_SECONDS * 1000) {
      return this.cached.servers;
    }
    return undefined;
  }
}

function toIceServers(raw: NtsIceServer[] | undefined): IceServer[] {
  return (raw ?? []).flatMap((s) => {
    const urls = s.urls ?? s.url;
    if (!urls) return [];
    return [
      {
        urls,
        ...(s.username && { username: s.username }),
        ...(s.credential && { credential: s.credential }),
      },
    ];
  });
}
