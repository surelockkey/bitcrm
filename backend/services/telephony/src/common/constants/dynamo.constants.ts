export const CALLS_TABLE = process.env.CALLS_TABLE || 'BitCRM_Calls';

// Single-table design (mirrors the CRM tables):
//   Call record:  PK=CALL#<callSid>, SK=METADATA
//   Agent index (GSI1): GSI1PK=AGENT#<userId>, GSI1SK=<startedAt>#<callSid>
//     → an agent's call history, newest-last (query ScanIndexForward=false).
//   All-calls index (GSI2): GSI2PK='CALL#ALL', GSI2SK=<startedAt>#<callSid>
//     → the global time-ordered call log (calls page list + live calls).
//   Party index (GSI3): GSI3PK=PARTY#<kind>#<id>, GSI3SK=<startedAt>#<callSid>
//     → every call with one client or teammate, without scanning the log.
//   Config collections in the same table, no GSI keys (never in the log):
//     NUMSET#ALL / <E.164>          per-number settings (number-settings.repository)
//     TELEPHONY#SETTINGS / METADATA workspace singleton (telephony-settings.service)
//     CALLTAG#ALL / CALLTAG#<id>    call-tag catalog (call-tags/call-tags.constants)
export const CALLS_GSI1_NAME = 'AgentIndex';
export const CALLS_GSI2_NAME = 'AllCallsIndex';
export const CALLS_GSI3_NAME = 'PartyIndex';
/**
 * The call log is partitioned by the month a call started in. One constant
 * key would put every call — 1.8 M of them after the Workiz import — in a
 * single DynamoDB partition: 1 000 writes a second at most (hours of
 * throttling on the import alone) and every read of the log queued behind
 * the same partition. Months are strictly ordered, so the log is still one
 * walk, just one partition at a time.
 */
export const allCallsPk = (startedAt: string) => `CALL#${startedAt.slice(0, 7)}`;

/** The earliest month the log can hold; Workiz's own first call is in 2018. */
export const CALLS_MIN_MONTH = '2015-01';

/**
 * The `YYYY-MM` partitions a window touches, newest first — the order the
 * log is read in. Without a lower bound it reaches back to
 * {@link CALLS_MIN_MONTH}; a window running backwards touches none.
 */
export function monthsDescending(from?: string, to?: string): string[] {
  const last = (to ?? new Date().toISOString()).slice(0, 7);
  const first = (from ?? CALLS_MIN_MONTH).slice(0, 7);
  if (last < first) return [];
  const out: string[] = [];
  let [y, m] = last.split('-').map(Number);
  while (out.length < 600) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key <= first) break;
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export const partyGsiPk = (kind: string, id: string) => `PARTY#${kind}#${id}`;

export const callPk = (callSid: string) => `CALL#${callSid}`;
export const agentGsiPk = (userId: string) => `AGENT#${userId}`;
export const allCallsSk = (startedAt: string, callSid: string) =>
  `${startedAt}#${callSid}`;

/**
 * Job codes for the technician dial-in, in the same table as the calls they
 * create. Two items per job that ever gets one, and both are needed:
 *
 *   Code:      PK=EXT#<code>,     SK=METADATA  → the (code) → job lookup
 *   Reverse:   PK=EXTOF#<dealId>, SK=METADATA  → makes minting idempotent
 *
 * Nothing in this repo uses DynamoDB TTL, so a released code is swept by a
 * scheduled script rather than expiring on its own — and the allocator's
 * conditional put fails on ANY existing row regardless of status, so a code
 * that connected somebody to the Hendersons cannot, three weeks later,
 * connect somebody to the Wus.
 */
export const extPk = (code: string) => `EXT#${code}`;
export const extOfPk = (dealId: string) => `EXTOF#${dealId}`;
