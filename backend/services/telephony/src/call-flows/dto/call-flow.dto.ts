import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CALL_FLOW_LIMITS, type CallFlowNode } from '@bitcrm/types';

/**
 * Nodes arrive as a free-form map and are validated in the service, not here:
 * the rules that matter are cross-node — every `next` pointing somewhere real,
 * no cycles, an entry node that exists — and class-validator can't see across
 * the shape to check any of them.
 */
export class CreateCallFlowDto {
  @ApiProperty({ example: 'Main line' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CALL_FLOW_LIMITS.nameMaxLength)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @ApiPropertyOptional({ type: [String], example: ['+14045550100'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  numbers?: string[];

  @ApiPropertyOptional({ description: 'Node id the call starts at.' })
  @IsOptional()
  @IsString()
  entryNodeId?: string;

  @ApiPropertyOptional({ description: 'id → node.' })
  @IsOptional()
  @IsObject()
  nodes?: Record<string, CallFlowNode>;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** Everything optional — an omitted field keeps its stored value. */
export class UpdateCallFlowDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CALL_FLOW_LIMITS.nameMaxLength)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  numbers?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entryNodeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  nodes?: Record<string, CallFlowNode>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/**
 * The three-field form P1 ships: a greeting, the group to ring, and what
 * happens when nobody answers. It builds the node graph server-side so the
 * first flows can't be malformed, and the node editor arrives in P2 over the
 * same storage.
 */
export class SimpleCallFlowDto {
  @ApiProperty({ example: 'Main line' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CALL_FLOW_LIMITS.nameMaxLength)
  name!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  numbers?: string[];

  @ApiPropertyOptional({ example: 'Thanks for calling Sure Lock Key.' })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  greeting?: string;

  @ApiProperty({ description: 'Call group to ring.' })
  @IsString()
  @IsNotEmpty()
  groupId!: string;

  @ApiPropertyOptional({ enum: ['voicemail', 'hangup'], default: 'voicemail' })
  @IsOptional()
  @IsIn(['voicemail', 'hangup'])
  noAnswer?: 'voicemail' | 'hangup';

  @ApiPropertyOptional({ example: 'Please leave a message after the tone.' })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  voicemailPrompt?: string;

  @ApiPropertyOptional({ default: CALL_FLOW_LIMITS.defaultVoicemailSeconds })
  @IsOptional()
  @IsInt()
  @Min(CALL_FLOW_LIMITS.minVoicemailSeconds)
  @Max(CALL_FLOW_LIMITS.maxVoicemailSeconds)
  voicemailSeconds?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
