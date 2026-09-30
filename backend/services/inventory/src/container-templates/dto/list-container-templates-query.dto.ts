import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { InventoryStatus } from '@bitcrm/types';

export class ListContainerTemplatesQueryDto {
  @ApiPropertyOptional({ enum: InventoryStatus, default: InventoryStatus.ACTIVE })
  @IsOptional()
  @IsEnum(InventoryStatus)
  status?: InventoryStatus;
}
