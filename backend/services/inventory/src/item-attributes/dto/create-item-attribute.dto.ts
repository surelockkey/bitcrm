import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ITEM_ATTRIBUTE_TYPES, type ItemAttributeType } from '@bitcrm/types';

const trim = Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class CreateItemAttributeDto {
  @ApiProperty({ example: 'In Store Location' })
  @IsString()
  @trim
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ enum: ITEM_ATTRIBUTE_TYPES, default: 'text' })
  @IsOptional()
  @IsIn(ITEM_ATTRIBUTE_TYPES as unknown as string[])
  type?: ItemAttributeType;

  @ApiPropertyOptional({ default: false, description: 'Workiz "Visible On Item List".' })
  @IsOptional()
  @IsBoolean()
  visible?: boolean;
}
