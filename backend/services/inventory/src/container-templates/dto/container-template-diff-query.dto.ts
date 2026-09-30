import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ContainerTemplateDiffQueryDto {
  @ApiProperty({ description: 'The container compared against the template.' })
  @IsString()
  @IsNotEmpty()
  containerId!: string;

  @ApiPropertyOptional({
    description: 'A warehouse to fill from: adds `available` and `willMove` to every line.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  warehouseId?: string;
}
