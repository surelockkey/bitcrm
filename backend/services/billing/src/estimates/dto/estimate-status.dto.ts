import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ESTIMATE_STATUSES, type EstimateStatus } from '@bitcrm/types';

export class SetEstimateStatusDto {
  @ApiProperty({ enum: ESTIMATE_STATUSES })
  @IsIn(ESTIMATE_STATUSES as unknown as string[])
  status!: EstimateStatus;
}
