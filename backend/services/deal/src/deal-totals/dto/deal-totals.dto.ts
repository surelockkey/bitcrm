import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** At most this many ids per request — a month of Call Tracking is ~3,300 jobs, sent in pages. */
export const DEAL_TOTALS_MAX_IDS = 1000;

export class DealTotalsDto {
  @ApiProperty({ type: [String], description: `Deal ids. At most ${DEAL_TOTALS_MAX_IDS}; unknown ones are absent from the answer.` })
  @IsArray()
  @ArrayMaxSize(DEAL_TOTALS_MAX_IDS)
  @IsString({ each: true })
  ids!: string[];
}
