import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CALL_GROUP_LIMITS, type CallGroupChannel, type CallGroupType } from '@bitcrm/types';

const TYPES: CallGroupType[] = ['ring_all', 'in_order'];
const CHANNELS: CallGroupChannel[] = ['softphone', 'personal', 'both'];

export class CallGroupMemberDto {
  @ApiProperty({ example: 'd47814b8-e051-706e-ac37-8818320d3c28' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({ enum: CHANNELS, example: 'softphone' })
  @IsIn(CHANNELS)
  channel!: CallGroupChannel;

  @ApiPropertyOptional({ description: 'Ring position; defaults to list order.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CreateCallGroupDto {
  @ApiProperty({ example: 'Dispatch' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CALL_GROUP_LIMITS.nameMaxLength)
  name!: string;

  @ApiPropertyOptional({ example: 'Everyone who takes new job calls.' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @ApiPropertyOptional({ enum: TYPES, default: 'ring_all' })
  @IsOptional()
  @IsIn(TYPES)
  type?: CallGroupType;

  @ApiPropertyOptional({ type: [CallGroupMemberDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CallGroupMemberDto)
  members?: CallGroupMemberDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ default: CALL_GROUP_LIMITS.defaultRingSeconds })
  @IsOptional()
  @IsInt()
  @Min(CALL_GROUP_LIMITS.minRingSeconds)
  @Max(CALL_GROUP_LIMITS.maxRingSeconds)
  ringSeconds?: number;
}

/** Everything is optional — an omitted field keeps its stored value. */
export class UpdateCallGroupDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CALL_GROUP_LIMITS.nameMaxLength)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @ApiPropertyOptional({ enum: TYPES })
  @IsOptional()
  @IsIn(TYPES)
  type?: CallGroupType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(CALL_GROUP_LIMITS.minRingSeconds)
  @Max(CALL_GROUP_LIMITS.maxRingSeconds)
  ringSeconds?: number;
}

/**
 * The whole membership, replaced in one write — add, remove and reorder are
 * the same operation from the editor's point of view, and a replace can't
 * interleave into a half-applied list.
 */
export class SetCallGroupMembersDto {
  @ApiProperty({ type: [CallGroupMemberDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CallGroupMemberDto)
  members!: CallGroupMemberDto[];
}
