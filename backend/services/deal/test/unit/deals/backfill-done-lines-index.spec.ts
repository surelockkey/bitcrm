/**
 * `backfill:done-lines-index` — reconciles the Done-lines keys (GSI7 on the
 * jobs' `PRODUCT#` rows): files the lines of live Done jobs, moves lines whose
 * job's day changed, removes keys from lines whose job left Done (or is gone),
 * and only an `--apply` run that finished stamps `DONELINESINDEX / STATE`.
 */
import { DealStatus, JobSuperStatus } from '@bitcrm/types';
import { reconcileDoneLines } from '../../../src/scripts/backfill-done-lines-index';
import { fakeDealsTable } from './report/fake-deals-table';

const TABLE = 'BitCRM_Deals';
const meta = (id: string, over: Record<string, unknown> = {}) => ({
  PK: `DEAL#${id}`,
  SK: 'METADATA',
  id,
  status: DealStatus.ACTIVE,
  superStatus: JobSuperStatus.DONE,
  scheduledDate: '2026-09-12',
  createdAt: '2026-09-10T15:00:00.000Z',
  // The job's own EndIndex keys: never touched.
  GSI7PK: 'END#2026-09',
  GSI7SK: '2026-09-12T11:00#DEAL#' + id,
  ...over,
});
const line = (dealId: string, key: string, over: Record<string, unknown> = {}) => ({ PK: `DEAL#${dealId}`, SK: `PRODUCT#${key}`, ...over });

function seed() {
  return [
    meta('d1'),
    line('d1', 'a'), // to file
    line('d1', 'b', { GSI7PK: 'DONELINES#2026-09', GSI7SK: '2026-09-12#DEAL#d1#b' }), // already right
    meta('d2', { scheduledDate: '2026-10-03' }),
    line('d2', 'c', { GSI7PK: 'DONELINES#2026-09', GSI7SK: '2026-09-12#DEAL#d2#c' }), // moved
    meta('d3', { superStatus: JobSuperStatus.IN_PROGRESS }),
    line('d3', 'd', { GSI7PK: 'DONELINES#2026-09', GSI7SK: '2026-09-12#DEAL#d3#d' }), // left Done
    line('gone', 'e', { GSI7PK: 'DONELINES#2026-09', GSI7SK: '2026-09-12#DEAL#gone#e' }), // job row gone
    { PK: 'DEAL#d1', SK: 'TIMELINE#x', GSI7PK: undefined }, // not a line
  ];
}

describe('reconcileDoneLines', () => {
  it('a dry run counts and writes nothing, not even the readiness row', async () => {
    const t = fakeDealsTable(seed());
    const r = await reconcileDoneLines(t.send as never, { table: TABLE, apply: false, log: () => undefined });
    expect(r).toMatchObject({ lines: 5, same: 1, set: 2, removed: 2, qualifying: 3 });
    expect(r.readyAt).toBeUndefined();
    expect(t.calls.filter((c) => c.name !== 'ScanCommand')).toHaveLength(0);
  });

  it('--apply sets, moves and removes, leaves METADATA rows alone, then stamps readiness', async () => {
    const t = fakeDealsTable(seed());
    const r = await reconcileDoneLines(t.send as never, { table: TABLE, apply: true, log: () => undefined });
    expect(r).toMatchObject({ set: 2, removed: 2, skipped: 0 });
    expect(t.rows.get('DEAL#d1|PRODUCT#a')).toMatchObject({ GSI7PK: 'DONELINES#2026-09', GSI7SK: '2026-09-12#DEAL#d1#a' });
    expect(t.rows.get('DEAL#d2|PRODUCT#c')).toMatchObject({ GSI7PK: 'DONELINES#2026-10', GSI7SK: '2026-10-03#DEAL#d2#c' });
    expect(t.rows.get('DEAL#d3|PRODUCT#d')!.GSI7PK).toBeUndefined();
    expect(t.rows.get('DEAL#gone|PRODUCT#e')!.GSI7PK).toBeUndefined();
    expect(t.rows.get('DEAL#d1|METADATA')!.GSI7PK).toBe('END#2026-09');
    expect(t.rows.get('DONELINESINDEX|STATE')).toMatchObject({ readyAt: r.readyAt, count: 3 });

    // Idempotent: a second run changes nothing but the stamp.
    const again = await reconcileDoneLines(t.send as never, { table: TABLE, apply: true, log: () => undefined });
    expect(again).toMatchObject({ set: 0, removed: 0, same: 5 });
  });

  it('decides on the job as it is NOW: a job that turned Done during the run is not taken off', async () => {
    const t = fakeDealsTable(seed());
    const scan = t.send.getMockImplementation()!;
    t.send.mockImplementation(async (cmd: any) => {
      const out = await scan(cmd);
      // After the scan saw d3 open, it turns Done (and its live write restamped the line).
      if (cmd.constructor.name === 'ScanCommand') t.rows.get('DEAL#d3|METADATA')!.superStatus = JobSuperStatus.DONE;
      return out;
    });
    const r = await reconcileDoneLines(t.send as never, { table: TABLE, apply: true, log: () => undefined });
    expect(t.rows.get('DEAL#d3|PRODUCT#d')).toMatchObject({ GSI7PK: 'DONELINES#2026-09' });
    expect(r.removed).toBe(1);
  });

  it('a line rewritten under the run (keys changed since the scan) is skipped, never overwritten', async () => {
    const t = fakeDealsTable(seed());
    const real = t.send.getMockImplementation()!;
    t.send.mockImplementation(async (cmd: any) => {
      const out = await real(cmd);
      if (cmd.constructor.name === 'ScanCommand') t.rows.get('DEAL#d1|PRODUCT#a')!.GSI7SK = 'someone-else';
      return out;
    });
    const r = await reconcileDoneLines(t.send as never, { table: TABLE, apply: true, log: () => undefined });
    expect(r.skipped).toBe(1);
    expect(t.rows.get('DEAL#d1|PRODUCT#a')!.GSI7SK).toBe('someone-else');
  });
});
