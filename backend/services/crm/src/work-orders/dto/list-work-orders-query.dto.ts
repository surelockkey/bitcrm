import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WorkOrderStatus } from '@bitcrm/types';

export class ListWorkOrdersQueryDto {
  @ApiPropertyOptional({ example: 'company-uuid' })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional({ enum: WorkOrderStatus })
  @IsOptional()
  @IsEnum(WorkOrderStatus)
  status?: WorkOrderStatus;
}
