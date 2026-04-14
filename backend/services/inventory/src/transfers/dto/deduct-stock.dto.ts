import {
  IsArray,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class DeductItemDto {
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

export class DeductStockDto {
  @ApiProperty()
  @IsString()
  containerId!: string;

  @ApiProperty({ type: [DeductItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeductItemDto)
  items!: DeductItemDto[];

  @ApiProperty()
  @IsString()
  dealId!: string;

  @ApiProperty()
  @IsString()
  performedBy!: string;

  @ApiProperty()
  @IsString()
  performedByName!: string;
}
