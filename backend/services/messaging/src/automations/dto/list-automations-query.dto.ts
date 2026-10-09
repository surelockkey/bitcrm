import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/**
 * `GET /automations` — the Automation Center lists every rule; the
 * Notifications page asks for its own rows only (`category=notification`,
 * `AUTOMATION_NOTIFICATION_CATEGORY`). Any category is accepted, since the
 * imported Workiz rules carry theirs (`job`, `phone`, `lead`, …) too.
 */
export class ListAutomationsQueryDto {
  @ApiPropertyOptional({
    example: 'notification',
    description: 'Only rules of this category (`notification` = the rows the Notifications page owns). Omitted: every rule.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  category?: string;
}
