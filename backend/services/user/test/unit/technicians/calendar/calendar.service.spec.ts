import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CalendarEventType, type CalendarEvent, type JwtUser } from '@bitcrm/types';
import { CalendarService } from '../../../../src/technicians/calendar/calendar.service';

const manager: JwtUser = {
  id: 'mgr-1', cognitoSub: 's', email: 'm@x.com', roleId: 'role-manager', department: 'HQ',
};
const tech: JwtUser = {
  id: 'tech-1', cognitoSub: 's', email: 't@x.com', roleId: 'role-technician', department: 'Field',
};

function existing(over?: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'evt-1', technicianId: 'tech-1', type: CalendarEventType.TIME_OFF, title: 'Vacation',
    startDate: '2026-07-24', endDate: '2026-07-26', allDay: true,
    createdBy: 'mgr-1', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

const validDraft = {
  type: CalendarEventType.LUNCH, title: 'Lunch',
  startDate: '2026-07-24', endDate: '2026-07-24', allDay: false, timeSlot: '12:00-13:00',
};

describe('CalendarService', () => {
  let repo: {
    create: jest.Mock; listByTechInRange: jest.Mock; findById: jest.Mock;
    update: jest.Mock; delete: jest.Mock;
  };
  let roles: { findById: jest.Mock };
  let service: CalendarService;

  beforeEach(() => {
    repo = {
      create: jest.fn().mockResolvedValue(undefined),
      listByTechInRange: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(existing()),
      update: jest.fn().mockImplementation((_k, attrs) => Promise.resolve(existing(attrs))),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    roles = {
      findById: jest.fn((id: string) =>
        Promise.resolve(
          id === 'role-manager'
            ? { id, name: 'Manager', priority: 50, isSystem: false }
            : { id: 'role-technician', name: 'Technician', priority: 10, isSystem: false },
        ),
      ),
    };
    service = new CalendarService(repo as never, roles as never);
  });

  describe('listForTech', () => {
    it('lets a technician read their own events', async () => {
      await service.listForTech('tech-1', '2026-07-20', '2026-07-26', tech);
      expect(repo.listByTechInRange).toHaveBeenCalledWith('tech-1', '2026-07-20', '2026-07-26');
    });
    it('lets a manager read another tech’s events', async () => {
      await expect(
        service.listForTech('tech-1', '2026-07-20', '2026-07-26', manager),
      ).resolves.toBeDefined();
    });
    it('forbids a technician reading someone else’s events', async () => {
      await expect(
        service.listForTech('tech-2', '2026-07-20', '2026-07-26', tech),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('listForTechs (bulk grid)', () => {
    it('is privileged-only and fans out per tech', async () => {
      await service.listForTechs(['tech-1', 'tech-2'], '2026-07-20', '2026-07-26', manager);
      expect(repo.listByTechInRange).toHaveBeenCalledTimes(2);
    });
    it('forbids a technician from the bulk endpoint', async () => {
      await expect(
        service.listForTechs(['tech-1'], '2026-07-20', '2026-07-26', tech),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('create', () => {
    it('is manager-only', async () => {
      await expect(service.create('tech-1', validDraft, tech)).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('persists a valid event stamped with the creator', async () => {
      const evt = await service.create('tech-1', validDraft, manager);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ technicianId: 'tech-1', createdBy: 'mgr-1', timeSlot: '12:00-13:00' }),
      );
      expect(evt.id).toBeTruthy();
    });
    it('rejects an incoherent shape (all-day + slot)', async () => {
      await expect(
        service.create('tech-1', { ...validDraft, allDay: true }, manager),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates in place when startDate is unchanged', async () => {
      await service.update('tech-1', 'evt-1', { title: 'Updated' }, manager);
      expect(repo.update).toHaveBeenCalled();
      expect(repo.delete).not.toHaveBeenCalled();
    });
    it('delete+recreates (same id) when startDate moves, since the SK embeds the date', async () => {
      await service.update('tech-1', 'evt-1', { startDate: '2026-07-25', endDate: '2026-07-25' }, manager);
      expect(repo.delete).toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-1', startDate: '2026-07-25' }));
    });
    it('404s an unknown event', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.update('tech-1', 'nope', { title: 'x' }, manager)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('is manager-only', async () => {
      await expect(service.update('tech-1', 'evt-1', { title: 'x' }, tech)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('deletes an existing event (manager)', async () => {
      await service.remove('tech-1', 'evt-1', manager);
      expect(repo.delete).toHaveBeenCalled();
    });
    it('is manager-only', async () => {
      await expect(service.remove('tech-1', 'evt-1', tech)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
