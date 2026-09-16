import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const EXPORT_PAGE_DEFAULT = 200;
export const EXPORT_PAGE_MAX = 500;

/**
 * `GET /conversations/internal/all?limit=&cursor=` — the search backfill's
 * page. Bigger pages than the inbox: the reader is a service walking the
 * whole table once, not a browser rendering a list.
 */
export class InternalExportQueryDto {
  @ApiPropertyOptional({ default: EXPORT_PAGE_DEFAULT, minimum: 1, maximum: EXPORT_PAGE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EXPORT_PAGE_MAX)
  limit: number = EXPORT_PAGE_DEFAULT;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page (`{ s, y, k? }`).' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
