import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** Settings → Estimates: a switch left out is left alone. */
export class UpdateEstimateSettingsDto {
  @ApiPropertyOptional({ description: '"Attach PDF files": an emailed estimate / invoice carries its PDF beside the portal link.' })
  @IsOptional()
  @IsBoolean()
  attachPdf?: boolean;

  @ApiPropertyOptional({
    description: '"Auto-decline estimates related to the same job": approving one declines the job’s other open estimates.',
  })
  @IsOptional()
  @IsBoolean()
  autoDeclineSameJob?: boolean;
}
