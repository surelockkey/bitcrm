import {
  IsArray,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class RestoreItemDto {
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

export class RestoreStockDto {
  @ApiProperty()
  @IsString()
  containerId!: string;

  @ApiProperty({ type: [RestoreItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestoreItemDto)
  items!: RestoreItemDto[];

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
