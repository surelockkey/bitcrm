import {
  ArrayMaxSize,
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
import { MAX_FILTER_VALUES, QueryList } from '../../common/utils/query-list';

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

  @ApiPropertyOptional({
    type: [String],
    description: 'Entries made by this user — repeat the parameter for any of several (Workiz "user").',
  })
  @IsOptional()
  @QueryList()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsString({ each: true })
  userId?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'A warehouse or container id, matched against both sides of the move (`fromId` or ' +
      '`toId`); repeat for any of several (Workiz "Location").',
  })
  @IsOptional()
  @QueryList()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsString({ each: true })
  locationId?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Item category NAME, as the entry snapshotted it when it was written; repeat for any of ' +
      'several. Entries written before the snapshot existed carry none and never match.',
  })
  @IsOptional()
  @QueryList()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsString({ each: true })
  category?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Item brand id, as snapshotted on the entry; repeat for any of several.',
  })
  @IsOptional()
  @QueryList()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsString({ each: true })
  brandId?: string[];

  @ApiPropertyOptional({ enum: InventoryLogAction })
  @IsOptional()
  @IsEnum(InventoryLogAction)
  action?: InventoryLogAction;

  @ApiPropertyOptional({
    description:
      'Matched against the product name and SKU — on a `container_assigned` entry, which ' +
      'names no item, against the name of the user whose container changed.',
  })
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
