import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hasPermission } from '@bitcrm/shared';
import {
  TIME_CLOCK_MIN_MINUTES,
  type JwtUser,
  type TimeClockEntry,
  type TimeClockLocation,
  type TimeClockSummary,
} from '@bitcrm/types';
import {
  ClockAlreadyOpenError,
  TimeClockRepository,
} from './timeclock.repository';
import { elapsedMs, minutesBetween, MS_PER_MINUTE } from './timeclock.util';
import { UsersService } from '../../users/users.service';
import { StartTimeClockDto } from './dto/start-timeclock.dto';
import { StopTimeClockDto } from './dto/stop-timeclock.dto';

/**
 * Reading somebody else's timesheet is a payroll question, not a dispatch one,
 * so it hangs off `reports.view` — held by dispatchers, managers and admins,
 * and deliberately `false` on the technician role. `technicians.view` would not
 * do: a technician holds that (it is how their own app reads profiles), and
 * hours are the one thing colleagues must not read off each other.
 */
const TIMESHEET_READ_RESOURCE = 'reports';
const TIMESHEET_READ_ACTION = 'view';

/**
 * Why a clock-in on a job writes NO timeline entry on that job.
 *
 * The job timeline is the story of the work — assigned, sent to tech, seen,
 * confirmed, en route, arrived, note, photo, status. A punch is a statement
 * about a person's pay, not about the job, and the three reasons not to mix
 * them are:
 *
 *  1. Workiz doesn't. Clock in/out lands in the account activity log
 *     ("User clocked in"), while the job's own feed shows arrival. Copying its
 *     UX means copying where the event goes, not only that it exists.
 *  2. Most punches have no job to file under — 2 342 of 15 277 records in this
 *     account's export carry a `job_id` (15.3%). A feed that shows the minority
 *     teaches dispatch to read absence as "he never clocked in".
 *  3. The job already says what the timeline is for: `tech_arrived` is stamped
 *     by deal-service from the technician's own Arrived button, seconds apart
 *     from the punch. Two lines for one act is noise.
 *
 * Mechanically it would also be a cross-service write user-service cannot make:
 * deal-service owns timeline entries, consumes no user-events today, and has no
 * internal endpoint for writing one. `dealId` on the entry is what actually
 * answers "how long was he on job X" — as a timesheet query, where it belongs.
 */

@Injectable()
export class TimeClockService {
  private readonly logger = new Logger(TimeClockService.name);

  constructor(
    private readonly repository: TimeClockRepository,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Punch in. The instant is the server's, and the running-entry slot is
   * claimed atomically — see `TimeClockRepository.createOpen`.
   *
   * A second start while one is running is a 409 carrying the entry that is
   * already open, not a silent success and not a second shift. Silently
   * returning the running entry would hide the case this exists to catch — a
   * stop that never reached the server, leaving a technician "on the clock"
   * overnight — and opening a second one would double-pay the overlap. The
   * app can still recover without a round trip: the running entry is in the
   * response body, so "you are already clocked in since 08:12" is one render
   * away, which is exactly what the offline outbox needs when its own start
   * was delivered but the reply was lost.
   */
  async start(caller: JwtUser, dto: StartTimeClockDto): Promise<TimeClockEntry> {
    const now = new Date().toISOString();
    const entry: TimeClockEntry = {
      id: randomUUID(),
      userId: caller.id,
      startedAt: now,
      dealId: dto.dealId,
      ...(toLocation(dto) ? { startLocation: toLocation(dto) } : {}),
      source: dto.source,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.repository.createOpen(entry);
    } catch (error) {
      if (error instanceof ClockAlreadyOpenError) {
        const running = await this.repository.getOpen(caller.id);
        throw new ConflictException({
          message: 'You are already clocked in',
          entry: running,
        });
      }
      throw error;
    }

    this.logger.log(
      `Clock in: user=${caller.id} entry=${entry.id}` +
        (entry.dealId ? ` deal=${entry.dealId}` : ''),
    );
    return entry;
  }

  /**
   * Punch out. `minutes` is computed here from the two server stamps; nothing
   * the client sends can influence it.
   */
  async stop(caller: JwtUser, dto: StopTimeClockDto): Promise<TimeClockEntry> {
    const open = await this.repository.getOpen(caller.id);
    if (!open) {
      throw new ConflictException('You are not clocked in');
    }

    const endedAt = new Date().toISOString();
    const spanMs = elapsedMs(open.startedAt, endedAt);
    if (spanMs < TIME_CLOCK_MIN_MINUTES * MS_PER_MINUTE) {
      throw new BadRequestException(
        'You must stay clocked in for at least one minute before clocking out',
      );
    }

    const closed = await this.repository.close(open, {
      endedAt,
      minutes: minutesBetween(open.startedAt, endedAt),
      endLocation: toLocation(dto),
    });

    this.logger.log(
      `Clock out: user=${caller.id} entry=${closed.id} minutes=${closed.minutes}`,
    );
    return closed;
  }

  /** The caller's running entry, or null. Never anybody else's. */
  async current(caller: JwtUser): Promise<TimeClockEntry | null> {
    return this.repository.getOpen(caller.id);
  }

  /**
   * A timesheet for a range. Defaults to the caller's own; another person's
   * needs `reports.view`.
   */
  async list(
    caller: JwtUser,
    from: string,
    to: string,
    userId?: string,
  ): Promise<TimeClockSummary> {
    const target = userId ?? caller.id;
    if (target !== caller.id) {
      await this.assertCanReadOthers(caller);
    }

    const entries = await this.repository.listByUserInRange(target, from, to);
    return {
      entries,
      totalMinutes: entries.reduce((sum, e) => sum + (e.minutes ?? 0), 0),
    };
  }

  /**
   * The id of the entry a technician is currently clocked into, if any. The
   * location track uses it to stamp its breadcrumbs, and to keep silent when
   * nobody is on the clock.
   */
  async openEntryId(userId: string): Promise<string | null> {
    const open = await this.repository.getOpen(userId);
    return open?.id ?? null;
  }

  private async assertCanReadOthers(caller: JwtUser): Promise<void> {
    const resolved = await this.usersService.getResolvedPermissions(caller.id);
    if (!hasPermission(resolved, TIMESHEET_READ_RESOURCE, TIMESHEET_READ_ACTION)) {
      throw new ForbiddenException('You can only view your own timesheet');
    }
  }
}

function toLocation(dto: {
  lat?: number;
  lng?: number;
  accuracy?: number;
}): TimeClockLocation | undefined {
  // Both halves or neither — a lone latitude is not a place.
  if (dto.lat === undefined || dto.lng === undefined) return undefined;
  return {
    lat: dto.lat,
    lng: dto.lng,
    ...(dto.accuracy !== undefined ? { accuracy: dto.accuracy } : {}),
  };
}
