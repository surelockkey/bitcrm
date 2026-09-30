import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches } from 'class-validator';

/**
 * The job as deal-service sees it — sent with a job's stock deduct / restore
 * and on its own when the job changes (`PUT /usage/internal/deals/:id/job`),
 * so the usage report can file and show the row by the job. An absent
 * `scheduledDate` means the job has none; any other absent field keeps what
 * the row already holds.
 */
export class UsageJobDto {
  @ApiProperty({ example: 'K4T9ZW', description: 'The Job ID people read (`Deal.dealNumber`).' })
  @IsString()
  dealNumber!: string;

  @ApiPropertyOptional({ example: '2026-09-10', description: "The job's scheduled date, `YYYY-MM-DD`." })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'scheduledDate must be YYYY-MM-DD' })
  scheduledDate?: string;

  @ApiPropertyOptional({ example: 'Kristie Spegal', description: "The client's display name on the job." })
  @IsOptional()
  @IsString()
  clientName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  techIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Aligned with `techIds`.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  techNames?: string[];
}
