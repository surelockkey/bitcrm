import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

/**
 * Body of `POST /products/internal/by-ids` (contract C2). Duplicates are
 * dropped; more than `PRODUCTS_BY_IDS_MAX` distinct ids is a 400 (the service
 * checks it after the dedupe).
 */
export class ProductsByIdsDto {
  @ApiProperty({ type: [String], description: 'Product ids; duplicates ignored, at most 500 distinct' })
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}
