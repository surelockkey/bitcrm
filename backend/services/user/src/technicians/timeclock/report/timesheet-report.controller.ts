import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { TIMESHEET_REPORT_MAX_DAYS, type JwtUser } from '@bitcrm/types';
import { TimesheetReportService } from './timesheet-report.service';
import {
  TimesheetEntriesQueryDto,
  TimesheetReportQueryDto,
  parseTimesheetEntriesQuery,
  parseTimesheetReportQuery,
} from './timesheet-report.query';

const RULES =
  'Hours = minutes on the clock with overlapping entries counted once; Gross Hours = Σ of the entries\' own ' +
  'minutes; Cost = minutes × each entry\'s labor rate, a shared stretch paid once; Jobs = distinct jobs. ' +
  'A running entry counts nothing. Days are the account\'s calendar (America/New_York), both included, ' +
  `at most ${TIMESHEET_REPORT_MAX_DAYS}; an entry belongs to the day it started on.`;

/**
 * The Workiz Timesheets report (`/root/timesheet`). Registered from
 * TechniciansModule with the rest of the time clock, ahead of `/users/:id`.
 */
@ApiTags('Time Clock')
@ApiBearerAuth()
@Controller('timeclock/report')
export class TimesheetReportController {
  constructor(private readonly report: TimesheetReportService) {}

  @Get()
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'Timesheets report — one line per person with hours, cost and jobs of a period',
    description:
      '**Guard:** `reports.view`. Cost and Gross Cost are left out without `financials.view` (`money: false`). ' +
      `${RULES} Filters: \`userId\` (Team), \`job\` = with_job | without_job; \`q\` searches the name. ` +
      '`sort` = name | hours | cost | jobs (default name), `dir` (default desc), `page`, `pageSize` (default 10). ' +
      'The total row covers every line the filter and search leave, not only the page.',
  })
  async page(@Query() query: TimesheetReportQueryDto, @CurrentUser() user: JwtUser) {
    const data = await this.report.report(parseTimesheetReportQuery(query), user);
    return { success: true, data };
  }

  @Get('entries')
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'Timesheets report — one person\'s entries of the period (the opened row)',
    description:
      '**Guard:** `reports.view`; money as above. Every entry that started in the period, newest first, ' +
      'with the person\'s Total and Gross Total. `job` carries the report\'s Jobs filter.',
  })
  async entries(@Query() query: TimesheetEntriesQueryDto, @CurrentUser() user: JwtUser) {
    const data = await this.report.entries(parseTimesheetEntriesQuery(query), user);
    return { success: true, data };
  }
}
