import { PartialType } from '@nestjs/swagger';
import { CreateCalendarEventDto } from './create-calendar-event.dto';

/** All fields optional; the service revalidates the merged shape. */
export class UpdateCalendarEventDto extends PartialType(CreateCalendarEventDto) {}
