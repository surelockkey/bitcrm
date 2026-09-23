/**
 * `GET /deals` with a visit-date window, an undated tab, or a schedule sort
 * routes to the StatusScheduleIndex; the window is bounded so nothing reads
 * a whole status partition by accident (web-deals-scale design, step 2).
 */
import { BadRequestException } from '@nestjs/common';
import { JobSuperStatus, SUPER_STATUS_ORDER } from '@bitcrm/types';
import { DealsService } from '../../../src/deals/deals.service';
import { createMockDealsRepository, createMockJwtUser } from '../mocks';

const caller = createMockJwtUser({ id: 'disp-1', roleId: 'role-dispatcher' });
const page = { items: [], nextCursor: undefined };

function serviceWith(repo: ReturnType<typeof createMockDealsRepository>): DealsService {
  const stub = {} as any;
  return new DealsService(
    repo as any, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
  );
}

describe('DealsService.list — the schedule window', () => {
  let repo: ReturnType<typeof createMockDealsRepository>;
  let service: DealsService;

  beforeEach(() => {
    repo = createMockDealsRepository();
    (repo as any).findBySchedule = jest.fn().mockResolvedValue(page);
    for (const fn of ['findBySuperStatus', 'findByTech', 'findByContact', 'findByDispatcher', 'findAll']) {
      (repo as any)[fn].mockResolvedValue(page);
    }
    service = serviceWith(repo);
  });

  it('a status with a date window reads that status on the schedule index', async () => {
    await service.list(
      { superStatus: JobSuperStatus.SUBMITTED, scheduledFrom: '2026-09-21', scheduledTo: '2026-09-27' } as any,
      caller,
    );
    expect((repo as any).findBySchedule).toHaveBeenCalledWith(
      [JobSuperStatus.SUBMITTED],
      { from: '2026-09-21', to: '2026-09-27', unscheduled: false },
      20,
      undefined,
      expect.any(Object),
      'asc',
    );
    expect(repo.findBySuperStatus).not.toHaveBeenCalled();
  });

  it('a date window without a status fans out over every status', async () => {
    await service.list({ scheduledFrom: '2026-09-23', scheduledTo: '2026-09-23' } as any, caller);
    const [statuses] = (repo as any).findBySchedule.mock.calls[0];
    expect(statuses).toEqual(SUPER_STATUS_ORDER);
  });

  it('a single day needs only scheduledFrom', async () => {
    await service.list({ superStatus: JobSuperStatus.DONE, scheduledFrom: '2026-09-23' } as any, caller);
    const [, window] = (repo as any).findBySchedule.mock.calls[0];
    expect(window).toEqual({ from: '2026-09-23', to: '2026-09-23', unscheduled: false });
  });

  it('unscheduled without a status covers the open statuses only — a closed job with no date is not a tab', async () => {
    await service.list({ unscheduled: 'true' } as any, caller);
    const [statuses, window] = (repo as any).findBySchedule.mock.calls[0];
    expect(statuses).toEqual(SUPER_STATUS_ORDER.filter((s) => s !== JobSuperStatus.DONE && s !== JobSuperStatus.CANCELED));
    expect(window.unscheduled).toBe(true);
  });

  it('sort=schedule alone (no window) reads the status in schedule order, descending on request', async () => {
    await service.list({ superStatus: JobSuperStatus.PENDING, sort: 'schedule', dir: 'desc' } as any, caller);
    expect((repo as any).findBySchedule).toHaveBeenCalledWith(
      [JobSuperStatus.PENDING],
      { from: undefined, to: undefined, unscheduled: false },
      20,
      undefined,
      expect.any(Object),
      'desc',
    );
  });

  it('a window wider than 31 days is refused', async () => {
    await expect(
      service.list({ scheduledFrom: '2026-01-01', scheduledTo: '2026-02-15' } as any, caller),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((repo as any).findBySchedule).not.toHaveBeenCalled();
  });

  it('a malformed date or a window running backwards is refused', async () => {
    await expect(service.list({ scheduledFrom: '23.09.2026' } as any, caller)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.list({ scheduledFrom: '2026-09-27', scheduledTo: '2026-09-21' } as any, caller),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a malformed hour is refused, a good one becomes a filter', async () => {
    await expect(
      service.list({ superStatus: JobSuperStatus.SUBMITTED, scheduledFrom: '2026-09-23', hourFrom: '8am' } as any, caller),
    ).rejects.toBeInstanceOf(BadRequestException);
    await service.list(
      { superStatus: JobSuperStatus.SUBMITTED, scheduledFrom: '2026-09-23', hourFrom: '08:00', hourTo: '12:00' } as any,
      caller,
    );
    const [, , , , filters] = (repo as any).findBySchedule.mock.calls[0];
    expect(filters).toEqual(expect.objectContaining({ hourFrom: '08:00', hourTo: '12:00' }));
  });

  it('subStatusId and the technician reach the schedule query as filters', async () => {
    await service.list(
      { superStatus: JobSuperStatus.SUBMITTED, scheduledFrom: '2026-09-23', subStatusId: 'sub-1' } as any,
      caller,
      'assigned_only',
    );
    const [, , , , filters] = (repo as any).findBySchedule.mock.calls[0];
    expect(filters).toEqual(expect.objectContaining({ subStatusId: 'sub-1', techId: 'disp-1' }));
  });

  it('without any of the new parameters the old routing is untouched', async () => {
    await service.list({ superStatus: JobSuperStatus.SUBMITTED } as any, caller);
    expect(repo.findBySuperStatus).toHaveBeenCalled();
    expect((repo as any).findBySchedule).not.toHaveBeenCalled();
  });
});
