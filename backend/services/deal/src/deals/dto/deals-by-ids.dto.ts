import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DealsByIdsDto {
  @ApiProperty({ type: [String], description: 'Deal ids to hydrate — a search result, a board delta. At most 100.' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids!: string[];
}

/** At most this many ids in one `POST /deals/internal/by-ids` (K1). */
export const INTERNAL_BY_IDS_MAX = 500;

export class InternalDealsByIdsDto {
  @ApiProperty({
    type: [String],
    description: `Deal ids — duplicates are read once, missing ones are absent from the answer. At most ${INTERNAL_BY_IDS_MAX}.`,
  })
  @IsArray()
  @ArrayMaxSize(INTERNAL_BY_IDS_MAX)
  @IsString({ each: true })
  ids!: string[];
}
