export const CALLS_TABLE = process.env.CALLS_TABLE || 'BitCRM_Calls';

// Single-table design (mirrors the CRM tables):
//   Call record:  PK=CALL#<callSid>, SK=METADATA
//   Agent index (GSI1): GSI1PK=AGENT#<userId>, GSI1SK=<startedAt>#<callSid>
//     → an agent's call history, newest-last (query ScanIndexForward=false).
//   All-calls index (GSI2): GSI2PK='CALL#ALL', GSI2SK=<startedAt>#<callSid>
//     → the global time-ordered call log (calls page list + live calls).
export const CALLS_GSI1_NAME = 'AgentIndex';
export const CALLS_GSI2_NAME = 'AllCallsIndex';
export const ALL_CALLS_PK = 'CALL#ALL';

export const callPk = (callSid: string) => `CALL#${callSid}`;
export const agentGsiPk = (userId: string) => `AGENT#${userId}`;
export const allCallsSk = (startedAt: string, callSid: string) =>
  `${startedAt}#${callSid}`;
