import { IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class ReceiveStockItemDto {
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

export class ReceiveWarehouseStockDto {
  @ApiProperty({ type: [ReceiveStockItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveStockItemDto)
  items!: ReceiveStockItemDto[];
}
