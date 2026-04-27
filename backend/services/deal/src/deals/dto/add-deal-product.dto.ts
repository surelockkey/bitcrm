import { IsString, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddDealProductDto {
  @ApiProperty({ example: 'product-uuid' })
  @IsString()
  productId!: string;

  @ApiProperty({ example: 'Kwikset Deadbolt' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'KW-DB-001' })
  @IsString()
  sku!: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 15.0 })
  @IsNumber()
  costCompany!: number;

  @ApiProperty({ example: 20.0 })
  @IsNumber()
  costForTech!: number;

  @ApiProperty({ example: 45.0 })
  @IsNumber()
  priceClient!: number;
}
