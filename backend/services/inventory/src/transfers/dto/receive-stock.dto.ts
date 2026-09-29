import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  STOCK_LOCATION_TYPES,
  StockMovementItemDto,
  type StockLocationType,
} from './stock-movement-item.dto';

/** Workiz "Add to stock": from the supplier into a warehouse or a container. */
export class ReceiveStockDto {
  @ApiProperty({ enum: STOCK_LOCATION_TYPES })
  @IsIn(STOCK_LOCATION_TYPES)
  toType!: StockLocationType;

  @ApiProperty()
  @IsString()
  toId!: string;

  @ApiProperty({ type: [StockMovementItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockMovementItemDto)
  items!: StockMovementItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
