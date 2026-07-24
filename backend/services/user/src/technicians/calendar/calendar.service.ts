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

  /** Bulk fetch for the day/week grid — manager only, fanned out per technician. */
  async listForTechs(
    technicianIds: string[],
    from: string,
    to: string,
    caller: JwtUser,
  ): Promise<CalendarEvent[]> {
    await this.assertManager(caller);
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
      await this.repository.delete(current);
      await this.repository.create(next);
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
    const callerRole = await this.rolesService.findById(caller.roleId);
    if (callerRole.isSystem && callerRole.name === 'Super Admin') return true;
    const techRole = await this.rolesService.findById(TECHNICIAN_ROLE_ID);
    return callerRole.priority > techRole.priority;
  }
}
