import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { AUTOMATION_NAME_MAX_LENGTH } from '../automations.constants';
import { AutomationSpecDto } from './automation-spec.dto';

/**
 * `POST /automations` — a rule written in the Automation Center, from a
 * library recipe or from scratch. The spec is the same class `PATCH` takes,
 * so a rule cannot be created in a shape the editor would then refuse.
 */
export class CreateAutomationDto {
  @ApiProperty({ example: 'Job canceled — notify the techs' })
  @IsString()
  @Length(1, AUTOMATION_NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({
    type: AutomationSpecDto,
    description: 'The trigger, conditions, actions and timing the engine runs.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => AutomationSpecDto)
  spec!: AutomationSpecDto;

  @ApiPropertyOptional({
    description:
      'Switch the rule on at once. Off by default — a new rule is reviewed before it texts anybody. ' +
      'Creating an enabled rule the engine cannot act on answers 422 RULE_NOT_RUNNABLE.',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 'job', description: 'Library section the rule came from (`job`, `phone`, …).' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  category?: string;

  @ApiPropertyOptional({ description: 'One line about what the rule is for — shown on its card.' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string;
}
