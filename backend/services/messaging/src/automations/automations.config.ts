/**
 * What the automations read from the environment, resolved once at module
 * init and injected under `AUTOMATIONS_CONFIG` (the `OUTBOUND_CONFIG`
 * habit: services never touch `process.env`, tests hand in a literal).
 */
export interface AutomationsConfig {
  /** `DEAL_EVENTS_TO_MESSAGING_QUEUE_URL` — the SNS→SQS subscription on `deal-events`. Unset → no consumer. */
  dealEventsQueueUrl?: string;
  awsRegion: string;
  awsEndpoint?: string;
  /** `ENABLE_SQS_CONSUMER=true` — poll the queue (off in local dev without LocalStack). */
  consumerEnabled: boolean;
}

export const AUTOMATIONS_CONFIG = Symbol('AUTOMATIONS_CONFIG');

export function loadAutomationsConfig(env: NodeJS.ProcessEnv = process.env): AutomationsConfig {
  return {
    dealEventsQueueUrl: env.DEAL_EVENTS_TO_MESSAGING_QUEUE_URL || undefined,
    awsRegion: env.AWS_REGION || 'us-east-1',
    awsEndpoint: env.AWS_ENDPOINT || undefined,
    consumerEnabled: env.ENABLE_SQS_CONSUMER === 'true',
  };
}
