import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { Internal } from '../../common/decorators/internal.decorator';
import { CalendarService } from './calendar.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
import { ListCalendarEventsQueryDto } from './dto/list-calendar-events-query.dto';

/** Non-job blocks on a technician's day (time off / lunch / break / appointment). */
@ApiTags('Technician Calendar')
@ApiBearerAuth()
@Controller('technicians')
export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  // --- bulk grid read (must precede :id routes at the same depth) ---
  @Get('calendar-events')
  @RequirePermission('technicians', 'view')
  @ApiOperation({
    summary: 'Calendar events for many technicians in a date range',
    description: '**Guard:** `technicians.view` + manager. Backs the day/week schedule grid.',
  })
  async listForTechs(@Query() query: ListCalendarEventsQueryDto, @CurrentUser() user: JwtUser) {
    const techIds = (query.techIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const data = await this.service.listForTechs(techIds, query.from, query.to, user);
    return { success: true, data };
  }

  @Get('internal/calendar-events')
  @Internal()
  @ApiOperation({ summary: 'Internal: calendar events for techs in a range (deal-service)' })
  async listInternal(@Query() query: ListCalendarEventsQueryDto) {
    const techIds = (query.techIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const events = await Promise.all(
      techIds.map((id) => this.service.listForTechInternal(id, query.from, query.to)),
    );
    return { success: true, data: events.flat() };
  }

  @Get(':id/calendar-events')
  @RequirePermission('technicians', 'view')
  @ApiOperation({
    summary: 'One technician’s calendar events in a date range',
    description: '**Guard:** `technicians.view`. Manager+ or self.',
  })
  async listForTech(
    @Param('id') id: string,
    @Query() query: ListCalendarEventsQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.listForTech(id, query.from, query.to, user);
    return { success: true, data };
  }

  @Post(':id/calendar-events')
  @RequirePermission('technicians', 'edit')
  @ApiOperation({
    summary: 'Create a calendar event for a technician',
    description: '**Guard:** `technicians.edit` + manager. Technicians cannot create their own.',
  })
  async create(
    @Param('id') id: string,
    @Body() dto: CreateCalendarEventDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.create(id, dto, user);
    return { success: true, data };
  }

  @Put(':id/calendar-events/:eventId')
  @RequirePermission('technicians', 'edit')
  @ApiOperation({ summary: 'Update a calendar event', description: '**Guard:** `technicians.edit` + manager.' })
  async update(
    @Param('id') id: string,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateCalendarEventDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, eventId, dto, user);
    return { success: true, data };
  }

  @Delete(':id/calendar-events/:eventId')
  @RequirePermission('technicians', 'edit')
  @ApiOperation({ summary: 'Delete a calendar event', description: '**Guard:** `technicians.edit` + manager.' })
  async remove(
    @Param('id') id: string,
    @Param('eventId') eventId: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.service.remove(id, eventId, user);
    return { success: true, data: null };
  }
}
