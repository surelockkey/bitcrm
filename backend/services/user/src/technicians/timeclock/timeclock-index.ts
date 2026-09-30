import { type TimeClockEntry } from '@bitcrm/types';
import { timeClockIndexPk, timeClockIndexSk } from '../constants/dynamo.constants';
import { accountMonth } from './account-clock.util';

/**
 * The TimeClockIndex (GSI6) keys of a time-clock history item (`CLOCK#…`):
 * the account month its start falls in (America/New_York), then the start
 * instant and the id.
 *
 *   GSI6PK = TIMECLOCK#<YYYY-MM>
 *   GSI6SK = <startedAt ISO>#<id>
 *
 * One rule, three writers: `TimeClockRepository.createOpen` (every new
 * entry), `scripts/backfill-timeclock-index.ts` (rows written before the
 * index), and the Workiz import generator, which mirrors it
 * (workiz-data-parser `workiz/bitcrm/timeclock_rules.py: index_keys`). The
 * `CLOCK_OPEN` slot never carries these keys.
 */
export function timeClockIndexKeys(entry: Pick<TimeClockEntry, 'startedAt' | 'id'>): {
  GSI6PK: string;
  GSI6SK: string;
} {
  const month = accountMonth(entry.startedAt);
  if (!month) throw new Error(`Unreadable startedAt: ${entry.startedAt}`);
  return {
    GSI6PK: timeClockIndexPk(month),
    GSI6SK: timeClockIndexSk(entry.startedAt, entry.id),
  };
}
