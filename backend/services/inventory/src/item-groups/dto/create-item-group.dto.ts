import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemGroupMemberDto } from './item-group-member.dto';

const trim = Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Workiz's import takes 10 parts; its popup more. A job line list stays readable well under this. */
export const ITEM_GROUP_MAX_MEMBERS = 100;

/**
 * Workiz's "Create item group": the name, the description, the category
 * (optional) and the items. The type is Individual items — the one BitCRM
 * adds to a job.
 */
export class CreateItemGroupDto {
  @ApiProperty({ example: 'Storm Door 36" x 80"' })
  @IsString()
  @trim
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'An item category id; "" or null for none.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  categoryId?: string | null;

  @ApiPropertyOptional({ default: true, description: 'Offered in the pickers (Workiz "Active").' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiProperty({ type: [ItemGroupMemberDto], description: 'At least one; in the order the lines go on a job.' })
  @IsArray()
  @ArrayMaxSize(ITEM_GROUP_MAX_MEMBERS)
  @ValidateNested({ each: true })
  @Type(() => ItemGroupMemberDto)
  members!: ItemGroupMemberDto[];
}
