/**
 * What the automations read from the environment, resolved once at module
 * init and injected under `AUTOMATIONS_CONFIG` (the `OUTBOUND_CONFIG`
 * habit: services never touch `process.env`, tests hand in a literal).
 */
export interface AutomationsConfig {
  /** `DEAL_EVENTS_TO_MESSAGING_QUEUE_URL` — the SNS→SQS subscription on `deal-events`. Unset → no consumer. */
  dealEventsQueueUrl?: string;
  /** `CALL_EVENTS_TO_MESSAGING_QUEUE_URL` — the subscription on `call-events` (missed / answered call rules). */
  callEventsQueueUrl?: string;
  awsRegion: string;
  awsEndpoint?: string;
  /** `ENABLE_SQS_CONSUMER=true` — poll the queues (off in local dev without LocalStack). */
  consumerEnabled: boolean;
  /**
   * `ENABLE_AUTOMATION_SCHEDULER=true` — run the minute poller that fires
   * delayed, held and relative rules. Off by default and independent of the
   * queue consumers: a dev machine should not fire other people's timers.
   */
  schedulerEnabled: boolean;
  /** `AUTOMATION_SCHEDULER_INTERVAL_MS` — how often the poller looks (default 60 s). */
  schedulerIntervalMs: number;
}

export const AUTOMATIONS_CONFIG = Symbol('AUTOMATIONS_CONFIG');

export const DEFAULT_SCHEDULER_INTERVAL_MS = 60_000;

export function loadAutomationsConfig(env: NodeJS.ProcessEnv = process.env): AutomationsConfig {
  const interval = Number(env.AUTOMATION_SCHEDULER_INTERVAL_MS);
  return {
    dealEventsQueueUrl: env.DEAL_EVENTS_TO_MESSAGING_QUEUE_URL || undefined,
    callEventsQueueUrl: env.CALL_EVENTS_TO_MESSAGING_QUEUE_URL || undefined,
    awsRegion: env.AWS_REGION || 'us-east-1',
    awsEndpoint: env.AWS_ENDPOINT || undefined,
    consumerEnabled: env.ENABLE_SQS_CONSUMER === 'true',
    schedulerEnabled: env.ENABLE_AUTOMATION_SCHEDULER === 'true',
    schedulerIntervalMs: Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_SCHEDULER_INTERVAL_MS,
  };
}
