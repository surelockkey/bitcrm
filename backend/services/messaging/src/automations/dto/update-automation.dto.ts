import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_CONDITION_FIELDS,
  AUTOMATION_CONDITION_OPS,
  AUTOMATION_RECIPIENTS,
  AUTOMATION_TRIGGER_KINDS,
} from '@bitcrm/types';

/** Rule-engine trigger (`AutomationSpec.trigger`). */
export class AutomationTriggerDto {
  @ApiPropertyOptional({ enum: AUTOMATION_TRIGGER_KINDS })
  @IsIn(AUTOMATION_TRIGGER_KINDS as unknown as string[])
  kind!: string;

  @ApiPropertyOptional({ type: [String], description: 'Super-statuses entered (`deal.status_changed`).' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  to?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  from?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  toSubStatus?: string[];

  @ApiPropertyOptional({ description: 'A job created straight into the status fires too (Workiz). Default true.' })
  @IsOptional()
  @IsBoolean()
  onCreate?: boolean;

  @ApiPropertyOptional({ enum: ['missed', 'answered', 'voicemail', 'any'] })
  @IsOptional()
  @IsIn(['missed', 'answered', 'voicemail', 'any'])
  callOutcome?: string;

  @ApiPropertyOptional({ enum: ['inbound', 'outbound', 'any'] })
  @IsOptional()
  @IsIn(['inbound', 'outbound', 'any'])
  callDirection?: string;

  @ApiPropertyOptional({ enum: ['sms', 'email', 'in_app', 'any'] })
  @IsOptional()
  @IsIn(['sms', 'email', 'in_app', 'any'])
  messageChannel?: string;

  @ApiPropertyOptional({ enum: ['contact', 'company', 'user', 'none', 'any'] })
  @IsOptional()
  @IsIn(['contact', 'company', 'user', 'none', 'any'])
  messagePartyKind?: string;

  @ApiPropertyOptional({ enum: ['scheduledStart', 'scheduledEnd', 'statusChangedAt', 'createdAt'] })
  @IsOptional()
  @IsIn(['scheduledStart', 'scheduledEnd', 'statusChangedAt', 'createdAt'])
  anchor?: string;

  @ApiPropertyOptional({ description: 'Minutes after the anchor; negative is before. Up to 30 days either way.' })
  @IsOptional()
  @IsInt()
  @Min(-43200)
  @Max(43200)
  offsetMinutes?: number;
}

export class AutomationConditionDto {
  @ApiPropertyOptional({ enum: AUTOMATION_CONDITION_FIELDS })
  @IsIn(AUTOMATION_CONDITION_FIELDS as unknown as string[])
  field!: string;

  @ApiPropertyOptional({ enum: AUTOMATION_CONDITION_OPS })
  @IsIn(AUTOMATION_CONDITION_OPS as unknown as string[])
  op!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  values?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Display names for `values`, same order.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  labels?: string[];
}

export class AutomationActionDto {
  @ApiPropertyOptional({ enum: AUTOMATION_ACTION_TYPES })
  @IsIn(AUTOMATION_ACTION_TYPES as unknown as string[])
  type!: string;

  @ApiPropertyOptional({ enum: AUTOMATION_RECIPIENTS })
  @IsOptional()
  @IsIn(AUTOMATION_RECIPIENTS as unknown as string[])
  to?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  userIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  roleIds?: string[];

  @ApiPropertyOptional({ example: '+14045551234' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 320)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 128)
  templateId?: string;

  @ApiPropertyOptional({ description: 'Body with `{{short_codes}}`; wins over the template.' })
  @IsOptional()
  @IsString()
  @Length(0, 5000)
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 2048)
  url?: string;

  @ApiPropertyOptional({ enum: ['POST', 'PUT'] })
  @IsOptional()
  @IsIn(['POST', 'PUT'])
  method?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @ApiPropertyOptional({ description: 'JSON payload template for a webhook.' })
  @IsOptional()
  @IsString()
  @Length(0, 5000)
  payload?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 128)
  tagId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 64)
  superStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 128)
  subStatusId?: string;
}

export class AutomationTimingDto {
  @ApiPropertyOptional({ description: 'Wait this long after the trigger. Up to 30 days.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(43200)
  delayMinutes?: number;

  @ApiPropertyOptional({ enum: ['hold', 'skip', 'ignore'] })
  @IsOptional()
  @IsIn(['hold', 'skip', 'ignore'])
  quietHours?: string;

  @ApiPropertyOptional({ type: Object, example: { from: '08:00', to: '18:00' } })
  @IsOptional()
  @IsObject()
  workingHours?: { from: string; to: string };
}

/** `AutomationSpec` as the settings page sends it. */
export class AutomationSpecDto {
  @ApiPropertyOptional({ enum: [1] })
  @IsOptional()
  @IsIn([1])
  version?: number;

  @ApiPropertyOptional({ type: AutomationTriggerDto })
  @ValidateNested()
  @Type(() => AutomationTriggerDto)
  trigger!: AutomationTriggerDto;

  @ApiPropertyOptional({ type: [AutomationConditionDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AutomationConditionDto)
  conditions!: AutomationConditionDto[];

  @ApiPropertyOptional({ type: [AutomationActionDto] })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AutomationActionDto)
  actions!: AutomationActionDto[];

  @ApiPropertyOptional({ type: AutomationTimingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AutomationTimingDto)
  timing?: AutomationTimingDto;
}

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
  @Length(1, 120)
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
