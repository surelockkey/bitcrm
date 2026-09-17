import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { AUTOMATION_NAME_MAX_LENGTH } from '../automations.constants';
import { AutomationSpecDto } from './automation-spec.dto';

export {
  AutomationActionDto,
  AutomationConditionDto,
  AutomationSpecDto,
  AutomationTimingDto,
  AutomationTriggerDto,
} from './automation-spec.dto';

/** `PATCH /automations/:id` — what the settings page changes on a rule. */
export class UpdateAutomationDto {
  @ApiPropertyOptional({
    description:
      'Switch the rule on or off. A rule with no runnable spec answers 422 RULE_NOT_RUNNABLE with the reason.',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 'New job SMS to technician' })
  @IsOptional()
  @IsString()
  @Length(1, AUTOMATION_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    type: AutomationSpecDto,
    description:
      'The trigger, conditions, actions and timing the engine runs. Saving one makes the rule yours: it is never re-translated.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AutomationSpecDto)
  spec?: AutomationSpecDto;
}
