import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ITEM_GROUP_STATUSES, type ItemGroupStatus } from '@bitcrm/types';

export class ListItemGroupsQueryDto {
  @ApiPropertyOptional({ enum: ITEM_GROUP_STATUSES, default: 'all', description: "Workiz's status box." })
  @IsOptional()
  @IsIn(ITEM_GROUP_STATUSES as unknown as string[])
  status?: ItemGroupStatus;
}
