import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ITEM_ATTRIBUTE_TYPES, type ItemAttributeType } from '@bitcrm/types';

const trim = Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class UpdateItemAttributeDto {
  @ApiPropertyOptional({
    example: 'In Store Location',
    description: 'A rename moves the value to the new name on every item that has one.',
  })
  @IsOptional()
  @IsString()
  @trim
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: ITEM_ATTRIBUTE_TYPES })
  @IsOptional()
  @IsIn(ITEM_ATTRIBUTE_TYPES as unknown as string[])
  type?: ItemAttributeType;

  @ApiPropertyOptional({ description: 'Workiz "Visible On Item List".' })
  @IsOptional()
  @IsBoolean()
  visible?: boolean;
}
