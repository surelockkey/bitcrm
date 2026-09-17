import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { TimeClockService } from './timeclock.service';
import { StartTimeClockDto } from './dto/start-timeclock.dto';
import { StopTimeClockDto } from './dto/stop-timeclock.dto';
import { ListTimeClockQueryDto } from './dto/list-timeclock-query.dto';

/**
 * The time clock, as Workiz's Timesheet menu item works (mobile-app notes
 * §1.7): a technician clocks in to the day or to a job, clocks out, and reads
 * back their own hours.
 *
 * `start` and `stop` carry no user id — the clock is always the caller's own,
 * which is the only shape that cannot be made to punch for somebody else.
 *
 * Registered from TechniciansModule because that module is scanned before
 * UsersModule: `/api/users/:id` would otherwise be matched first and swallow
 * `/api/users/timeclock` (see the comment in app.module.ts).
 */
@ApiTags('Time Clock')
@ApiBearerAuth()
@Controller('timeclock')
export class TimeClockController {
  constructor(private readonly service: TimeClockService) {}

  @Post('start')
  @RequirePermission('technicians', 'edit')
  @ApiOperation({
    summary: 'Clock in',
    description:
      '**Guard:** `technicians.edit`; always the caller’s own clock. Starting one ' +
      'while another is running answers **409** with the running entry in the body ' +
      '(`{ message, entry }`) — never a second open shift. Coordinates are optional: ' +
      'a refused location permission must not stop anyone from working.',
  })
  async start(@Body() dto: StartTimeClockDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.start(user, dto);
    return { success: true, data };
  }

  @Post('stop')
  @HttpCode(200)
  @RequirePermission('technicians', 'edit')
  @ApiOperation({
    summary: 'Clock out',
    description:
      '**Guard:** `technicians.edit`; always the caller’s own clock. **409** when no ' +
      'clock is running, **400** when less than a minute has passed since clocking in ' +
      '(Workiz’s own rule). `minutes` is computed from the server’s two stamps.',
  })
  async stop(@Body() dto: StopTimeClockDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.stop(user, dto);
    return { success: true, data };
  }

  @Get('current')
  @RequirePermission('technicians', 'view')
  @ApiOperation({
    summary: 'The caller’s running entry, or null',
    description:
      '**Guard:** `technicians.view`; self only. What the app asks on launch to ' +
      'decide whether the button says Start or Stop.',
  })
  async current(@CurrentUser() user: JwtUser) {
    const data = await this.service.current(user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('technicians', 'view')
  @ApiOperation({
    summary: 'Timesheet for a date range',
    description:
      '**Guard:** `technicians.view` for one’s own; **`reports.view`** to pass a ' +
      '`userId` that is not the caller’s (technicians do not hold it). `totalMinutes` ' +
      'counts closed entries only.',
  })
  async list(@Query() query: ListTimeClockQueryDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.list(user, query.from, query.to, query.userId);
    return { success: true, data };
  }
}
