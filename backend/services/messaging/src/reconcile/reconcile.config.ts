/**
 * What the reconciliation module reads from the environment, resolved once
 * at module init and injected under `RECONCILE_CONFIG` (the `OUTBOUND_CONFIG`
 * habit: services never touch `process.env`, tests hand in a literal).
 */
export interface ReconcileConfig {
  /**
   * `MESSAGING_STATUS_SYNC_INTERVAL_SECONDS` — every this many seconds the
   * in-process poller asks Twilio about outbound lines this process handed
   * over that have no terminal status yet (a lost status callback, or a
   * developer machine Twilio cannot call back). `0` (the default) leaves it off.
   */
  statusSyncIntervalSeconds: number;
}

export const RECONCILE_CONFIG = Symbol('RECONCILE_CONFIG');

export const RECONCILE_ENV_VARS = ['MESSAGING_STATUS_SYNC_INTERVAL_SECONDS'] as const;

export function loadReconcileConfig(env: NodeJS.ProcessEnv = process.env): ReconcileConfig {
  const seconds = Number(env.MESSAGING_STATUS_SYNC_INTERVAL_SECONDS);
  return { statusSyncIntervalSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0 };
}
