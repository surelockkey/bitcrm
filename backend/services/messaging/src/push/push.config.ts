/**
 * What the push sender reads from the environment, resolved once and
 * injected under `PUSH_CONFIG` (the `AUTOMATIONS_CONFIG` habit: services
 * never touch `process.env`, tests hand in a literal).
 */
export interface PushConfig {
  /**
   * `PUSH_ENABLED` — the kill switch, on unless it says `false` / `0` / `off`
   * / `no`. Off, nothing is sent and no realtime frame is listened to; the
   * phones still register their tokens.
   */
  enabled: boolean;
  /**
   * `EXPO_ACCESS_TOKEN` — sent as `Authorization: Bearer` when set. Needed
   * only once the Expo project turns on "enhanced push security".
   */
  expoAccessToken?: string;
}

export const PUSH_CONFIG = Symbol('PUSH_CONFIG');

const OFF = new Set(['false', '0', 'off', 'no']);

export function loadPushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig {
  return {
    enabled: !OFF.has((env.PUSH_ENABLED ?? '').trim().toLowerCase()),
    expoAccessToken: env.EXPO_ACCESS_TOKEN?.trim() || undefined,
  };
}
