import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_CONDITION_FIELDS,
  AUTOMATION_CONDITION_OPS,
  AUTOMATION_RECIPIENTS,
  AUTOMATION_TRIGGER_KINDS,
} from '@bitcrm/types';

/**
 * `AutomationSpec` as the Automation Center sends it — shared by
 * `POST /automations` and `PATCH /automations/:id`, which take the very same
 * spec and must hold it to the very same bar (a create that validated more
 * loosely than an edit would let a rule in through the front door that the
 * editor then refuses to save).
 */

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

/**
 * One alternative of an OR group. Held to a stricter bar than a flat
 * condition on purpose: the evaluator reads "no values" as "this field is
 * not narrowed", which costs nothing in an AND list but makes the *whole*
 * group hold, throwing away every other alternative. One
 * `{field: 'jobType', op: 'in'}` next to three real sources is a rule that
 * fires for every job — the widening groups exist to prevent — so an
 * alternative has to actually narrow something.
 */
export class AutomationConditionDto {
  @ApiPropertyOptional({ enum: AUTOMATION_CONDITION_FIELDS })
  @IsIn(AUTOMATION_CONDITION_FIELDS as unknown as string[])
  field!: string;

  @ApiPropertyOptional({ enum: AUTOMATION_CONDITION_OPS })
  @IsIn(AUTOMATION_CONDITION_OPS as unknown as string[])
  op!: string;

  @ApiPropertyOptional({ type: [String] })
  @ValidateIf((o: AutomationConditionDto) => o.op !== 'exists' && o.op !== 'not_exists')
  @IsArray()
  @ArrayMinSize(1)
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

/**
 * One entry of `spec.conditions`: a plain condition, or an OR group
 * `{ any: [...] }` — Workiz's "only one of the conditions must be true",
 * which 25 of the 80 imported rules carry. The top level stays AND, so both
 * shapes travel in the same array and this class has to take either:
 * `field` / `op` are demanded only where there is no `any`, and a node that
 * carries an `any` array is the group (`isAutomationConditionGroup`), which
 * is the same rule the evaluator and the sentence read it by.
 */
export class AutomationConditionNodeDto {
  @ApiPropertyOptional({ enum: AUTOMATION_CONDITION_FIELDS })
  @ValidateIf((o: AutomationConditionNodeDto) => o.any === undefined)
  @IsIn(AUTOMATION_CONDITION_FIELDS as unknown as string[])
  field?: string;

  @ApiPropertyOptional({ enum: AUTOMATION_CONDITION_OPS })
  @ValidateIf((o: AutomationConditionNodeDto) => o.any === undefined)
  @IsIn(AUTOMATION_CONDITION_OPS as unknown as string[])
  op?: string;

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

  @ApiPropertyOptional({
    type: [AutomationConditionDto],
    description: 'An OR group: this entry holds when any one of these does. Groups do not nest.',
  })
  @ValidateIf((o: AutomationConditionNodeDto) => o.any !== undefined || o.field === undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AutomationConditionDto)
  any?: AutomationConditionDto[];
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

  @ApiPropertyOptional({ type: [AutomationConditionNodeDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AutomationConditionNodeDto)
  conditions!: AutomationConditionNodeDto[];

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
