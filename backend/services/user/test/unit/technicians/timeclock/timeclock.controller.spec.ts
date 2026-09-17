import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { type JwtUser, type TimeClockEntry } from '@bitcrm/types';
import { TimeClockController } from '../../../../src/technicians/timeclock/timeclock.controller';

const tech: JwtUser = {
  id: 'tech-1', cognitoSub: 's', email: 't@x.com', roleId: 'role-technician', department: 'Field',
};

const entry: TimeClockEntry = {
  id: 'tc-1',
  userId: 'tech-1',
  startedAt: '2026-09-17T08:00:00.000Z',
  source: 'mobile',
  createdAt: '2026-09-17T08:00:00.000Z',
  updatedAt: '2026-09-17T08:00:00.000Z',
};

describe('TimeClockController (unit)', () => {
  let service: {
    start: jest.Mock; stop: jest.Mock; current: jest.Mock; list: jest.Mock;
  };
  let controller: TimeClockController;

  beforeEach(() => {
    service = {
      start: jest.fn().mockResolvedValue(entry),
      stop: jest.fn().mockResolvedValue({ ...entry, endedAt: '2026-09-17T16:00:00.000Z', minutes: 480 }),
      current: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue({ entries: [], totalMinutes: 0 }),
    };
    controller = new TimeClockController(service as never);
  });

  // The routes are the contract the mobile app is being written against, so
  // the prefix is worth asserting rather than trusting.
  it('lives under /timeclock (→ /api/users/timeclock)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, TimeClockController)).toBe('timeclock');
    expect(Reflect.getMetadata(PATH_METADATA, controller.start)).toBe('start');
    expect(Reflect.getMetadata(PATH_METADATA, controller.stop)).toBe('stop');
    expect(Reflect.getMetadata(PATH_METADATA, controller.current)).toBe('current');
    expect(Reflect.getMetadata(METHOD_METADATA, controller.list)).toBe(0); // GET
  });

  // The clock is always the caller's: there is no id in the path or the body to
  // punch on somebody else's behalf.
  it('starts the caller’s own clock', async () => {
    const result = await controller.start({ source: 'mobile' }, tech);

    expect(service.start).toHaveBeenCalledWith(tech, { source: 'mobile' });
    expect(result).toEqual({ success: true, data: entry });
  });

  it('stops the caller’s own clock', async () => {
    const result = await controller.stop({ lat: 33.8, lng: -84.4 }, tech);

    expect(service.stop).toHaveBeenCalledWith(tech, { lat: 33.8, lng: -84.4 });
    expect(result.data.minutes).toBe(480);
  });

  it('returns null rather than 404 when no clock is running', async () => {
    expect(await controller.current(tech)).toEqual({ success: true, data: null });
  });

  it('passes the timesheet range and target through', async () => {
    await controller.list({ from: '2026-09-15', to: '2026-09-21', userId: 'tech-2' }, tech);
    expect(service.list).toHaveBeenCalledWith(tech, '2026-09-15', '2026-09-21', 'tech-2');
  });
});
