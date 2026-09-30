import { Injectable, Logger } from '@nestjs/common';
import { hasPermission } from '@bitcrm/shared';
import {
  type JwtUser,
  type TimeClockEntry,
  type TimesheetEntriesPage,
  type TimesheetReportPage,
} from '@bitcrm/types';
import { TimeClockRepository } from '../timeclock.repository';
import { UsersService } from '../../../users/users.service';
import { dayStartUtc, monthsCovering, shiftDay } from '../account-clock.util';
import {
  cents,
  passesJobFilter,
  paginate,
  personName,
  personTotals,
  publicRow,
  sortLines,
  toEntryRow,
  toLine,
  totalOf,
  matchesSearch,
} from './timesheet-report.logic';
import { type TimesheetEntriesQuery, type TimesheetReportQuery } from './timesheet-report.query';

/**
 * The Workiz Timesheets report — everyone's time-clock entries of a period,
 * one line per person, and a person's entries on demand.
 *
 * Reads: the TimeClockIndex (GSI6) partition of every account month the
 * period touches — at most 13 Queries for a year — then one BatchGetItem for
 * the names on the page and one for who is clocked in right now. A person's
 * own entries come off their own partition. Nothing here scans the table.
 */
@Injectable()
export class TimesheetReportService {
  private readonly logger = new Logger(TimesheetReportService.name);

  constructor(
    private readonly repository: TimeClockRepository,
    private readonly usersService: UsersService,
  ) {}

  async report(query: TimesheetReportQuery, caller: JwtUser): Promise<TimesheetReportPage> {
    const [money, entries] = await Promise.all([
      this.canSeeMoney(caller),
      this.windowEntries(query.from, query.to),
    ]);

    const team = query.filters.userId ? new Set(query.filters.userId) : null;
    const byUser = new Map<string, TimeClockEntry[]>();
    for (const e of entries) {
      if (team && !team.has(e.userId)) continue;
      if (!passesJobFilter(e, query.filters.job)) continue;
      const list = byUser.get(e.userId);
      if (list) list.push(e);
      else byUser.set(e.userId, [e]);
    }

    const ids = [...byUser.keys()];
    const [people, open] = await Promise.all([
      this.repository.peopleByIds(ids),
      this.repository.openUserIds(ids),
    ]);

    const lines = ids
      .map((id) =>
        toLine(id, personName(people.get(id), id), open.has(id), personTotals(byUser.get(id) ?? []), money),
      )
      .filter((l) => matchesSearch(l.name, query.q));

    const total = totalOf(lines, money);
    const { rows, pagination } = paginate(sortLines(lines, query.sort, query.dir), query.page, query.pageSize);
    return {
      rows: rows.map(publicRow),
      total,
      pagination,
      window: { from: query.from, to: query.to },
      sort: { column: query.sort, dir: query.dir },
      money,
    };
  }

  async entries(query: TimesheetEntriesQuery, caller: JwtUser): Promise<TimesheetEntriesPage> {
    const lo = dayStartUtc(query.from);
    const hi = dayStartUtc(shiftDay(query.to, 1));
    const [money, own, people, open] = await Promise.all([
      this.canSeeMoney(caller),
      // Their own partition — the same Query their phone's timesheet uses —
      // with the bounds of the account's days. The upper bound is the last
      // millisecond before the next day begins.
      this.repository.listByUserInRange(query.userId, lo, new Date(Date.parse(hi) - 1).toISOString()),
      this.repository.peopleByIds([query.userId]),
      this.repository.openUserIds([query.userId]),
    ]);

    const entries = own
      .filter((e) => e.startedAt >= lo && e.startedAt < hi)
      .filter((e) => passesJobFilter(e, query.job))
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
    const t = personTotals(entries);

    return {
      userId: query.userId,
      name: personName(people.get(query.userId), query.userId),
      clockedIn: open.has(query.userId),
      rows: entries.map((e) => toEntryRow(e, money)),
      total: {
        minutes: t.minutes,
        grossMinutes: t.grossMinutes,
        ...(money ? { cost: cents(t.cost), grossCost: cents(t.grossCost) } : {}),
      },
      window: { from: query.from, to: query.to },
      money,
    };
  }

  /** Every entry that started on the period's days, from each account month's index partition. */
  private async windowEntries(from: string, to: string): Promise<TimeClockEntry[]> {
    const lo = dayStartUtc(from);
    const hi = dayStartUtc(shiftDay(to, 1));
    const months = monthsCovering(from, to);
    const parts = await Promise.all(months.map((m) => this.repository.listStartedBetween(m, lo, hi)));
    const out = parts.flat();
    this.logger.debug(`Timesheets ${from}..${to}: ${months.length} month(s), ${out.length} entries`);
    return out;
  }

  /** Cost and labor rates are money: `financials.view`, as on the Jobs report. */
  private async canSeeMoney(caller: JwtUser): Promise<boolean> {
    const resolved = await this.usersService.getResolvedPermissions(caller.id);
    return hasPermission(resolved, 'financials', 'view');
  }
}
