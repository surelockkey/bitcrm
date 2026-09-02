/**
 * Call-flow rows, in the same shape as call groups: one partition holds every
 * flow, so listing is a single Query and a workspace's dozen flows can never
 * grow into a hot key.
 *
 *   PK = 'FLOW', SK = 'FLOW#<id>'
 */
export const CALL_FLOWS_TABLE =
  process.env.CALL_FLOWS_TABLE || 'BitCRM_CallFlows';

export const CALL_FLOW_PK = 'FLOW';
export const callFlowSk = (id: string) => `FLOW#${id}`;

/** Where a call's position in its flow is kept while the call is alive. */
export const flowStateKey = (callSid: string) => `telephony:flow:${callSid}`;
