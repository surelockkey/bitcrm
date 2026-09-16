import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

/** `PATCH /automations/:id` — the two things the settings page changes on a rule. */
export class UpdateAutomationDto {
  @ApiPropertyOptional({ description: 'Switch the rule on or off. Only built-in rules can be switched on (422 RULE_NOT_RUNNABLE otherwise).' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 'New job SMS to technician' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;
}
