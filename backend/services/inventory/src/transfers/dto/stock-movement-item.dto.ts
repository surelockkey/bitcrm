import { IsInt, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LocationType } from '@bitcrm/types';

/** The kinds that hold stock. The supplier is where received stock comes from and holds nothing. */
export const STOCK_LOCATION_TYPES = [LocationType.WAREHOUSE, LocationType.CONTAINER] as const;
export type StockLocationType = (typeof STOCK_LOCATION_TYPES)[number];

export class StockMovementItemDto {
  @ApiProperty()
  @IsString()
  productId!: string;

  @ApiProperty()
  @IsString()
  productName!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantity!: number;
}
