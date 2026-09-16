import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { AUTOMATION_RUN_OUTCOMES } from '@bitcrm/types';

export const AUTOMATION_RUNS_PAGE_DEFAULT = 50;
export const AUTOMATION_RUNS_PAGE_MAX = 200;

/** `GET /automations/runs` — the account-wide firing feed. */
export class ListAutomationRunsQueryDto {
  @ApiPropertyOptional({ default: AUTOMATION_RUNS_PAGE_DEFAULT, minimum: 1, maximum: AUTOMATION_RUNS_PAGE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AUTOMATION_RUNS_PAGE_MAX)
  limit: number = AUTOMATION_RUNS_PAGE_DEFAULT;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Only this rule (read from its own partition, so it sees every logged run).' })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  ruleId?: string;

  @ApiPropertyOptional({ enum: AUTOMATION_RUN_OUTCOMES })
  @IsOptional()
  @IsIn(AUTOMATION_RUN_OUTCOMES)
  outcome?: string;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z', description: 'Only firings at or after this instant.' })
  @IsOptional()
  @IsISO8601()
  since?: string;
}
