import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DealStage } from '@bitcrm/types';

export class ChangeStageDto {
  @ApiProperty({ enum: DealStage, example: DealStage.ASSIGNED })
  @IsEnum(DealStage)
  stage!: DealStage;

  @ApiPropertyOptional({ example: 'Customer resolved the issue themselves' })
  @IsOptional()
  @IsString()
  cancellationReason?: string;
}
