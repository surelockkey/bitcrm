import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { type CalendarEvent, type JwtUser } from '@bitcrm/types';
import { CalendarRepository } from './calendar.repository';
import { validateEventShape, type CalendarEventDraft } from './calendar.util';
import { RolesService } from '../../roles/roles.service';
import { MAX_INDEXED_WINDOW_MONTHS, monthsSpanned } from './calendar-month-index';

const TECHNICIAN_ROLE_ID = 'role-technician';

@Injectable()
export class CalendarService {
  constructor(
    private readonly repository: CalendarRepository,
    private readonly rolesService: RolesService,
  ) {}

  // --- reads ---

  async listForTech(
    technicianId: string,
    from: string,
    to: string,
    caller: JwtUser,
  ): Promise<CalendarEvent[]> {
    await this.assertCanView(caller, technicianId);
    return this.repository.listByTechInRange(technicianId, from, to);
  }

  /** Service-to-service read (deal-service availability); auth is the network guard. */
  async listForTechInternal(
    technicianId: string,
    from: string,
    to: string,
  ): Promise<CalendarEvent[]> {
    return this.repository.listByTechInRange(technicianId, from, to);
  }

  /** Bulk fetch for the day/week grid — manager only. */
  async listForTechs(
    technicianIds: string[],
    from: string,
    to: string,
    caller: JwtUser,
  ): Promise<CalendarEvent[]> {
    await this.assertManager(caller);
    return this.readMany(technicianIds, from, to);
  }

  /** The same bulk read for deal-service (availability); auth is the network guard. */
  async listForTechsInternal(
    technicianIds: string[],
    from: string,
    to: string,
  ): Promise<CalendarEvent[]> {
    return this.readMany(technicianIds, from, to);
  }

  /**
   * Many technicians' events: the window's months off the month index once
   * the backfill has stamped it ready (one Query per month, whatever the
   * number of technicians), else — and for a window wider than the index
   * serves — one per-technician Query each, as before. Same answer either way.
   */
  private async readMany(technicianIds: string[], from: string, to: string): Promise<CalendarEvent[]> {
    const months = monthsSpanned(from, to).length;
    if (
      technicianIds.length > 0 &&
      months > 0 &&
      months <= MAX_INDEXED_WINDOW_MONTHS &&
      (await this.repository.monthIndexReady())
    ) {
      return this.repository.listByTechsInRange(technicianIds, from, to);
    }
    const perTech = await Promise.all(
      technicianIds.map((id) => this.repository.listByTechInRange(id, from, to)),
    );
    return perTech.flat();
  }

  // --- writes (manager only) ---

  async create(
    technicianId: string,
    draft: CalendarEventDraft,
    caller: JwtUser,
  ): Promise<CalendarEvent> {
    await this.assertManager(caller);
    this.assertValidShape(draft);

    const now = new Date().toISOString();
    const event: CalendarEvent = {
      id: randomUUID(),
      technicianId,
      type: draft.type,
      title: draft.title,
      startDate: draft.startDate,
      endDate: draft.endDate,
      allDay: draft.allDay,
      timeSlot: draft.allDay ? undefined : draft.timeSlot,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.create(event);
    return event;
  }

  async update(
    technicianId: string,
    eventId: string,
    patch: Partial<CalendarEventDraft>,
    caller: JwtUser,
  ): Promise<CalendarEvent> {
    await this.assertManager(caller);
    const current = await this.repository.findById(technicianId, eventId);
    if (!current) throw new NotFoundException('Calendar event not found');

    const merged: CalendarEventDraft = {
      type: patch.type ?? current.type,
      title: patch.title ?? current.title,
      startDate: patch.startDate ?? current.startDate,
      endDate: patch.endDate ?? current.endDate,
      allDay: patch.allDay ?? current.allDay,
      timeSlot: patch.timeSlot ?? current.timeSlot,
    };
    this.assertValidShape(merged);

    const now = new Date().toISOString();
    const next: CalendarEvent = {
      ...current,
      ...merged,
      timeSlot: merged.allDay ? undefined : merged.timeSlot,
      updatedAt: now,
    };

    // The SK embeds startDate, so a date change is a move, not an in-place edit.
    if (next.startDate !== current.startDate) {
      await this.repository.move(current, next);
      return next;
    }
    return this.repository.update(current, {
      type: next.type,
      title: next.title,
      endDate: next.endDate,
      allDay: next.allDay,
      timeSlot: next.timeSlot,
      updatedAt: now,
    });
  }

  async remove(technicianId: string, eventId: string, caller: JwtUser): Promise<void> {
    await this.assertManager(caller);
    const current = await this.repository.findById(technicianId, eventId);
    if (!current) throw new NotFoundException('Calendar event not found');
    await this.repository.delete(current);
  }

  // --- guards ---

  private assertValidShape(draft: CalendarEventDraft): void {
    const error = validateEventShape(draft);
    if (error) throw new BadRequestException(error);
  }

  private async assertCanView(caller: JwtUser, technicianId: string): Promise<void> {
    if (caller.id === technicianId) return;
    if (await this.isPrivileged(caller)) return;
    throw new ForbiddenException('You can only view your own calendar');
  }

  private async assertManager(caller: JwtUser): Promise<void> {
    if (!(await this.isPrivileged(caller))) {
      throw new ForbiddenException('Only managers can manage calendar events');
    }
  }

  private async isPrivileged(caller: JwtUser): Promise<boolean> {
    if (!caller.roleId) throw new ForbiddenException('User has no roleId assigned');
    // The reference role is asked for alongside the caller's, but only awaited
    // where the old sequential code read it: a Super Admin never depends on it
    // (a missing reference role must not 404 them), anyone else gets its error.
    const techRoleRead = this.rolesService.findById(TECHNICIAN_ROLE_ID);
    techRoleRead.catch(() => undefined);
    const callerRole = await this.rolesService.findById(caller.roleId);
    if (callerRole.isSystem && callerRole.name === 'Super Admin') return true;
    const techRole = await techRoleRead;
    return callerRole.priority > techRole.priority;
  }
}
