import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DataScope, type JwtUser, type TimeClockEntry } from '@bitcrm/types';
import { TimeClockService } from '../../../../src/technicians/timeclock/timeclock.service';
import { ClockAlreadyOpenError } from '../../../../src/technicians/timeclock/timeclock.repository';

const tech: JwtUser = {
  id: 'tech-1', cognitoSub: 's', email: 't@x.com', roleId: 'role-technician', department: 'Field',
};
const dispatcher: JwtUser = {
  id: 'disp-1', cognitoSub: 's', email: 'd@x.com', roleId: 'role-dispatcher', department: 'HQ',
};

const START = '2026-09-17T08:00:00.000Z';

function open(over?: Partial<TimeClockEntry>): TimeClockEntry {
  return {
    id: 'tc-1',
    userId: 'tech-1',
    startedAt: START,
    source: 'mobile',
    createdAt: START,
    updatedAt: START,
    ...over,
  };
}

/** A permission set shaped like the resolver returns, with `reports.view` set. */
function permissions(reportsView: boolean) {
  return {
    roleId: 'role-x',
    roleName: 'Role X',
    isSystemRole: true,
    permissions: {
      technicians: { view: true, edit: true },
      reports: { view: reportsView },
    },
    dataScope: { technicians: DataScope.ALL },
    dealStageTransitions: [],
    hasOverrides: false,
  };
}

describe('TimeClockService', () => {
  let repo: {
    createOpen: jest.Mock;
    getOpen: jest.Mock;
    close: jest.Mock;
    listByUserInRange: jest.Mock;
  };
  let users: { getResolvedPermissions: jest.Mock };
  let service: TimeClockService;

  beforeEach(() => {
    repo = {
      createOpen: jest.fn().mockResolvedValue(undefined),
      getOpen: jest.fn().mockResolvedValue(null),
      close: jest.fn().mockImplementation(async (entry, patch) => ({ ...entry, ...patch })),
      listByUserInRange: jest.fn().mockResolvedValue([]),
    };
    users = { getResolvedPermissions: jest.fn().mockResolvedValue(permissions(true)) };
    service = new TimeClockService(repo as never, users as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('start', () => {
    it('opens an entry for the caller, stamped by the server', async () => {
      jest.useFakeTimers().setSystemTime(new Date(START));

      const entry = await service.start(tech, { source: 'mobile' });

      expect(entry.userId).toBe('tech-1');
      expect(entry.startedAt).toBe(START);
      expect(entry.endedAt).toBeUndefined();
      expect(entry.minutes).toBeUndefined();
    });

    it('records the job when the clock was started from one', async () => {
      const entry = await service.start(tech, { source: 'mobile', dealId: 'deal-9' });
      expect(entry.dealId).toBe('deal-9');
    });

    // A technician may refuse the location permission and must still be able to
    // work; the entry is valid without coordinates.
    it('accepts a clock-in with no coordinates at all', async () => {
      const entry = await service.start(tech, { source: 'mobile' });
      expect(entry.startLocation).toBeUndefined();
      expect(repo.createOpen).toHaveBeenCalled();
    });

    it('stores the start coordinates with their accuracy', async () => {
      const entry = await service.start(tech, {
        source: 'mobile', lat: 33.749, lng: -84.388, accuracy: 12,
      });
      expect(entry.startLocation).toEqual({ lat: 33.749, lng: -84.388, accuracy: 12 });
    });

    it('ignores a lone latitude — half a fix is not a place', async () => {
      const entry = await service.start(tech, { source: 'mobile', lat: 33.749 });
      expect(entry.startLocation).toBeUndefined();
    });

    // The honest answer to a double start: refuse, and hand back what is
    // already running so the app can say "clocked in since 08:00" without a
    // second round trip. Opening a second shift would double-pay the overlap;
    // silently succeeding would hide a stop that never arrived.
    it('answers a second start with 409 carrying the running entry', async () => {
      repo.createOpen.mockRejectedValue(new ClockAlreadyOpenError());
      repo.getOpen.mockResolvedValue(open());

      await expect(service.start(tech, { source: 'mobile' })).rejects.toBeInstanceOf(
        ConflictException,
      );

      try {
        await service.start(tech, { source: 'mobile' });
      } catch (error) {
        const body = (error as ConflictException).getResponse() as {
          message: string; entry: TimeClockEntry;
        };
        expect(body.message).toBe('You are already clocked in');
        expect(body.entry.id).toBe('tc-1');
        expect(body.entry.startedAt).toBe(START);
      }
    });

    it('never opens a second entry when one is running', async () => {
      repo.createOpen.mockRejectedValue(new ClockAlreadyOpenError());
      repo.getOpen.mockResolvedValue(open());

      await expect(service.start(tech, { source: 'mobile' })).rejects.toThrow();
      expect(repo.close).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('closes the running entry and computes the minutes itself', async () => {
      repo.getOpen.mockResolvedValue(open());
      jest.useFakeTimers().setSystemTime(new Date('2026-09-17T16:30:00.000Z'));

      const closed = await service.stop(tech, {});

      expect(closed.endedAt).toBe('2026-09-17T16:30:00.000Z');
      expect(closed.minutes).toBe(510);
    });

    // The phone's clock is not evidence. Nothing in the stop body can touch the
    // duration — there is no timestamp field, and the minutes come from the
    // server's own two stamps.
    it('derives the duration from the stored start, not from anything sent', async () => {
      repo.getOpen.mockResolvedValue(open());
      jest.useFakeTimers().setSystemTime(new Date('2026-09-17T09:00:00.000Z'));

      await service.stop(tech, { lat: 1, lng: 2, minutes: 999, endedAt: '2030-01-01T00:00:00.000Z' } as never);

      expect(repo.close.mock.calls[0][1].minutes).toBe(60);
      expect(repo.close.mock.calls[0][1].endedAt).toBe('2026-09-17T09:00:00.000Z');
    });

    it('stores the end coordinates with their accuracy', async () => {
      repo.getOpen.mockResolvedValue(open());
      jest.useFakeTimers().setSystemTime(new Date('2026-09-17T16:00:00.000Z'));

      const closed = await service.stop(tech, { lat: 33.8, lng: -84.4, accuracy: 8 });

      expect(closed.endLocation).toEqual({ lat: 33.8, lng: -84.4, accuracy: 8 });
    });

    it('closes without coordinates when the technician shared none', async () => {
      repo.getOpen.mockResolvedValue(open());
      jest.useFakeTimers().setSystemTime(new Date('2026-09-17T16:00:00.000Z'));

      await service.stop(tech, {});

      expect(repo.close.mock.calls[0][1].endLocation).toBeUndefined();
    });

    it('leaves the start coordinates exactly as they were', async () => {
      const startLocation = { lat: 33.749, lng: -84.388, accuracy: 12 };
      repo.getOpen.mockResolvedValue(open({ startLocation }));
      jest.useFakeTimers().setSystemTime(new Date('2026-09-17T16:00:00.000Z'));

      const closed = await service.stop(tech, { lat: 33.8, lng: -84.4 });

      expect(closed.startLocation).toEqual(startLocation);
    });

    // Workiz's own rule (help 18055805122065), and the reason it exists: a
    // double-tap otherwise litters the timesheet with zero-minute rows.
    it('refuses a stop less than a minute after the start, in words a person can read', async () => {
      repo.getOpen.mockResolvedValue(open());
      jest.useFakeTimers().setSystemTime(new Date(Date.parse(START) + 45_000));

      await expect(service.stop(tech, {})).rejects.toThrow(
        'You must stay clocked in for at least one minute before clocking out',
      );
      await expect(service.stop(tech, {})).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.close).not.toHaveBeenCalled();
    });

    it('allows a stop at exactly one minute', async () => {
      repo.getOpen.mockResolvedValue(open());
      jest.useFakeTimers().setSystemTime(new Date(Date.parse(START) + 60_000));

      const closed = await service.stop(tech, {});
      expect(closed.minutes).toBe(1);
    });

    it('answers a stop with nothing running as 409, not a 500', async () => {
      repo.getOpen.mockResolvedValue(null);

      await expect(service.stop(tech, {})).rejects.toBeInstanceOf(ConflictException);
      await expect(service.stop(tech, {})).rejects.toThrow('You are not clocked in');
    });
  });

  describe('current', () => {
    it('reads the caller’s own running entry', async () => {
      repo.getOpen.mockResolvedValue(open());
      expect((await service.current(tech))?.id).toBe('tc-1');
      expect(repo.getOpen).toHaveBeenCalledWith('tech-1');
    });

    it('returns null when nobody is clocked in', async () => {
      expect(await service.current(tech)).toBeNull();
    });
  });

  describe('list', () => {
    it('defaults to the caller’s own timesheet and needs no extra permission', async () => {
      await service.list(tech, '2026-09-15', '2026-09-21');

      expect(repo.listByUserInRange).toHaveBeenCalledWith('tech-1', '2026-09-15', '2026-09-21');
      expect(users.getResolvedPermissions).not.toHaveBeenCalled();
    });

    it('totals the closed entries only — a running shift is not a fact yet', async () => {
      repo.listByUserInRange.mockResolvedValue([
        open({ id: 'a', endedAt: '2026-09-17T12:00:00.000Z', minutes: 240 }),
        open({ id: 'b', endedAt: '2026-09-17T17:00:00.000Z', minutes: 180 }),
        open({ id: 'c' }),
      ]);

      const summary = await service.list(tech, '2026-09-17', '2026-09-17');

      expect(summary.entries).toHaveLength(3);
      expect(summary.totalMinutes).toBe(420);
    });

    // Hours are the one thing colleagues must not read off each other, and the
    // technician role does not hold reports.view.
    it('refuses one technician reading another’s timesheet', async () => {
      users.getResolvedPermissions.mockResolvedValue(permissions(false));

      await expect(service.list(tech, '2026-09-15', '2026-09-21', 'tech-2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.listByUserInRange).not.toHaveBeenCalled();
    });

    it('lets a dispatcher read a technician’s timesheet', async () => {
      await service.list(dispatcher, '2026-09-15', '2026-09-21', 'tech-1');
      expect(repo.listByUserInRange).toHaveBeenCalledWith('tech-1', '2026-09-15', '2026-09-21');
    });

    it('treats an unresolvable caller as denied', async () => {
      users.getResolvedPermissions.mockResolvedValue(null);
      await expect(
        service.list(dispatcher, '2026-09-15', '2026-09-21', 'tech-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a caller pass their own id explicitly without a permission check', async () => {
      await service.list(tech, '2026-09-15', '2026-09-21', 'tech-1');
      expect(users.getResolvedPermissions).not.toHaveBeenCalled();
    });
  });

  describe('openEntryId', () => {
    it('names the running entry for the location track to stamp', async () => {
      repo.getOpen.mockResolvedValue(open());
      expect(await service.openEntryId('tech-1')).toBe('tc-1');
    });

    it('is null when the technician is off the clock', async () => {
      expect(await service.openEntryId('tech-1')).toBeNull();
    });
  });
});
