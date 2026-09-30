import { IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryStatus } from '@bitcrm/types';

export class ListWarehousesQueryDto {
  @ApiPropertyOptional({ description: 'Matched against the name, case-insensitive.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: InventoryStatus })
  @IsOptional()
  @IsEnum(InventoryStatus)
  status?: InventoryStatus;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}
