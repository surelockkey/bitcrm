import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateJobRulesDto {
  @ApiPropertyOptional({
    example: true,
    description:
      'Workiz "Update Job End Time": a job marked Done or Canceled ends at that moment ' +
      '(its end date / time, and the "Job end date" reports with them). Omitted: unchanged.',
  })
  @IsOptional()
  @IsBoolean()
  updateJobEndTimeOnClose?: boolean;
}
