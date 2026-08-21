import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LocationType } from '@bitcrm/types';

export class MoveItemDestinationDto {
  @ApiProperty({ enum: LocationType })
  @IsEnum(LocationType)
  toType!: LocationType;

  @ApiProperty()
  @IsString()
  toId!: string;

  /** Zero is allowed and simply skipped — the UI renders a row per location. */
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  quantity!: number;
}

export class MoveItemDto {
  @ApiProperty({ enum: LocationType })
  @IsEnum(LocationType)
  fromType!: LocationType;

  @ApiProperty()
  @IsString()
  fromId!: string;

  @ApiProperty()
  @IsString()
  productId!: string;

  @ApiProperty()
  @IsString()
  productName!: string;

  @ApiProperty({ type: [MoveItemDestinationDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => MoveItemDestinationDto)
  destinations!: MoveItemDestinationDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
