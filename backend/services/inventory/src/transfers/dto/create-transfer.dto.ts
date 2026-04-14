import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LocationType } from '@bitcrm/types';

class TransferItemDto {
  @ApiProperty()
  @IsString()
  productId!: string;

  @ApiProperty()
  @IsString()
  productName!: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  quantity!: number;
}

export class CreateTransferDto {
  @ApiProperty({ enum: LocationType })
  @IsEnum(LocationType)
  fromType!: LocationType;

  @ApiProperty()
  @IsString()
  fromId!: string;

  @ApiProperty({ enum: LocationType })
  @IsEnum(LocationType)
  toType!: LocationType;

  @ApiProperty()
  @IsString()
  toId!: string;

  @ApiProperty({ type: [TransferItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  items!: TransferItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
