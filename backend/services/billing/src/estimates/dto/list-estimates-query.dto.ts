import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { ESTIMATE_STATUSES, type EstimateStatus } from '@bitcrm/types';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListEstimatesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ESTIMATE_STATUSES })
  @IsOptional()
  @IsIn(ESTIMATE_STATUSES as unknown as string[])
  status?: EstimateStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dealId?: string;
}
