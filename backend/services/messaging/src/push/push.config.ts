/**
 * What push reads from the environment, resolved once at module init and
 * injected under `PUSH_CONFIG` (the `OUTBOUND_CONFIG` habit: services never
 * touch `process.env`, tests hand in a literal).
 *
 * Nothing here needs AWS credentials or a paid account: Expo's push API
 * accepts an anonymous POST, and the access token is only required once the
 * project turns on "enhanced security" in the Expo dashboard.
 */
export interface PushConfig {
  /**
   * `PUSH_ENABLED=true` — the kill switch, **off by default**. Off, nothing
   * reads the registry and no HTTP call is made; every entry point says so
   * in one log line and returns. It exists so the service can ship, and be
   * deployed, before the owner's Apple and Google accounts do.
   */
  enabled: boolean;
  /** `EXPO_PUSH_URL` — the send endpoint (overridable so a test or a local stub can stand in). */
  sendUrl: string;
  /** `EXPO_RECEIPTS_URL` — where the delivery receipts for sent tickets are read back. */
  receiptsUrl: string;
  /** `EXPO_ACCESS_TOKEN` — sent as a bearer token when the Expo project requires one. */
  accessToken?: string;
  /** `PUSH_TIMEOUT_MS` — per HTTP attempt; a hung Expo must not hold a job event open. */
  timeoutMs: number;
  /** `PUSH_MAX_ATTEMPTS` — total tries per batch, including the first (429 / 5xx / network only). */
  maxAttempts: number;
  /** `PUSH_RETRY_BASE_MS` — first backoff; doubled per attempt. */
  retryBaseMs: number;
  /**
   * `PUSH_RECEIPT_DELAY_MS` — how long after a send the receipts are read
   * back. Expo asks for at least 15 minutes; earlier and the receipts are
   * simply not there yet.
   */
  receiptDelayMs: number;
}

export const PUSH_CONFIG = Symbol('PUSH_CONFIG');

export const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
export const DEFAULT_PUSH_TIMEOUT_MS = 10_000;
export const DEFAULT_PUSH_MAX_ATTEMPTS = 3;
export const DEFAULT_PUSH_RETRY_BASE_MS = 500;
export const DEFAULT_PUSH_RECEIPT_DELAY_MS = 15 * 60_000;

const positive = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export function loadPushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig {
  return {
    enabled: env.PUSH_ENABLED === 'true',
    sendUrl: env.EXPO_PUSH_URL || EXPO_SEND_URL,
    receiptsUrl: env.EXPO_RECEIPTS_URL || EXPO_RECEIPTS_URL,
    accessToken: env.EXPO_ACCESS_TOKEN || undefined,
    timeoutMs: positive(env.PUSH_TIMEOUT_MS, DEFAULT_PUSH_TIMEOUT_MS),
    maxAttempts: positive(env.PUSH_MAX_ATTEMPTS, DEFAULT_PUSH_MAX_ATTEMPTS),
    retryBaseMs: positive(env.PUSH_RETRY_BASE_MS, DEFAULT_PUSH_RETRY_BASE_MS),
    receiptDelayMs: positive(env.PUSH_RECEIPT_DELAY_MS, DEFAULT_PUSH_RECEIPT_DELAY_MS),
  };
}
