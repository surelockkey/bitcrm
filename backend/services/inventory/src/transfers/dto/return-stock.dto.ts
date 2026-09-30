import { IsArray, IsEnum, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReturnReason } from '@bitcrm/types';
import {
  STOCK_LOCATION_TYPES,
  StockMovementItemDto,
  type StockLocationType,
} from './stock-movement-item.dto';

/** Workiz "Return": stock leaves a location without a job — recalled, damaged or lost. */
export class ReturnStockDto {
  @ApiProperty({ enum: STOCK_LOCATION_TYPES })
  @IsIn(STOCK_LOCATION_TYPES)
  fromType!: StockLocationType;

  @ApiProperty()
  @IsString()
  fromId!: string;

  @ApiProperty({ type: [StockMovementItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockMovementItemDto)
  items!: StockMovementItemDto[];

  @ApiProperty({ enum: ReturnReason })
  @IsEnum(ReturnReason)
  reason!: ReturnReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
