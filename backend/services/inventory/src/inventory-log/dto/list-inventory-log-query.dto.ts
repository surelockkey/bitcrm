import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryLogAction } from '@bitcrm/types';

export class ListInventoryLogQueryDto {
  @ApiPropertyOptional({
    example: '2026-09-01T00:00:00.000Z',
    description:
      'Window start, inclusive. Defaults to the first day of the UTC month of `to`. ' +
      'At most 24 months before `to` (400 otherwise).',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-29T12:00:00.000Z',
    description:
      'Window end, inclusive. A date alone (`2026-09-10`) means the whole of that UTC day. Defaults to now.',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: "One item's history instead of the whole log." })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ description: 'Entries made by this user.' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ enum: InventoryLogAction })
  @IsOptional()
  @IsEnum(InventoryLogAction)
  action?: InventoryLogAction;

  @ApiPropertyOptional({ description: 'Matched against the product name and SKU.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description:
      'The `nextCursor` of the previous page. It carries the window it was minted under, so ' +
      '`from`/`to` sent with it are ignored; one minted with or without `productId` fits only ' +
      'the same kind of read (400 otherwise).',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}
