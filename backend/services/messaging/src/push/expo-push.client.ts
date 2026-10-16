import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { defaultFetch, type FetchLike } from '../outbound/internal/internal-fetch';
import { PUSH_CONFIG, type PushConfig } from './push.config';
import { type PushData } from './push.constants';

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo's limit per request. */
export const EXPO_PUSH_BATCH_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10_000;

/** Injection token for the HTTP fetch — swapped in unit tests. */
export const EXPO_PUSH_FETCH = Symbol('EXPO_PUSH_FETCH');

/** One notification to one device (Expo push message format). */
export interface ExpoPushMessage {
  to: string;
  title?: string;
  body?: string;
  data?: PushData;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
}

/** Expo's answer for one message: accepted (`id` for a later receipt) or refused. */
export type ExpoPushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message?: string; details?: { error?: string; expoPushToken?: string } };

/** The device uninstalled the app or revoked notifications — the token is dead for good. */
export const isDeviceNotRegistered = (ticket: ExpoPushTicket | undefined): boolean =>
  ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered';

/**
 * The Expo push service over plain HTTP (`POST /--/api/v2/push/send`, a JSON
 * array of at most 100 messages) — no SDK, the same injected `fetch` the
 * internal clients use. Never throws: a batch Expo refuses, a network
 * failure or an answer that cannot be read becomes one error ticket per
 * message of that batch, logged, and the remaining batches still go. The
 * answer is aligned with the input, one ticket per message.
 */
@Injectable()
export class ExpoPushClient {
  private readonly logger = new Logger(ExpoPushClient.name);

  constructor(
    @Inject(PUSH_CONFIG) private readonly config: PushConfig,
    @Optional() @Inject(EXPO_PUSH_FETCH) private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    const tickets: ExpoPushTicket[] = [];
    for (let i = 0; i < messages.length; i += EXPO_PUSH_BATCH_SIZE) {
      tickets.push(...(await this.sendBatch(messages.slice(i, i + EXPO_PUSH_BATCH_SIZE))));
    }
    return tickets;
  }

  private async sendBatch(batch: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    const failed = (message: string): ExpoPushTicket[] => {
      this.logger.warn(`Expo push batch of ${batch.length} not sent: ${message}`);
      return batch.map(() => ({ status: 'error', message }));
    };
    try {
      const res = await this.fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'accept-encoding': 'gzip, deflate',
          ...(this.config.expoAccessToken ? { authorization: `Bearer ${this.config.expoAccessToken}` } : {}),
        },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return failed(`Expo answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
      const body = (await res.json()) as { data?: unknown };
      if (!Array.isArray(body?.data)) return failed('Expo answer has no data array');
      return batch.map((_, i) => (body.data as ExpoPushTicket[])[i] ?? { status: 'error', message: 'no ticket for this message' });
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error));
    }
  }
}
