import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const FEED_PAGE_DEFAULT = 50;
export const FEED_PAGE_MAX = 100;

/** `?limit=&cursor=` for the feeds (conversation, job, flagged). */
export class PagingQueryDto {
  @ApiPropertyOptional({ default: FEED_PAGE_DEFAULT, minimum: 1, maximum: FEED_PAGE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FEED_PAGE_MAX)
  limit: number = FEED_PAGE_DEFAULT;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page ("load older").' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
