import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { AUTOMATION_NOTIFICATION_KINDS } from '@bitcrm/types';
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

  @ApiPropertyOptional({ example: 'notification', description: 'Re-file the rule under a category (`notification` = the Notifications page).' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  category?: string;

  @ApiPropertyOptional({
    enum: AUTOMATION_NOTIFICATION_KINDS,
    description: 'The Notifications-page form the rule belongs to — set when its editor saves the row in another form.',
  })
  @IsOptional()
  @IsIn(AUTOMATION_NOTIFICATION_KINDS as unknown as string[])
  notificationKind?: string;
}
