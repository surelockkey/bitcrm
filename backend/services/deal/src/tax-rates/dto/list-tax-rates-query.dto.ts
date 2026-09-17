import { IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListTaxRatesQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'Include archived (inactive) rates.' })
  @IsOptional()
  @IsIn(['true', 'false'])
  includeInactive?: string;
}
