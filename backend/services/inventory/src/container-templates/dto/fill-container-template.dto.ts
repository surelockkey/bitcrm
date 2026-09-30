import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** "Fill from warehouse": move what the container is missing from one warehouse. */
export class FillContainerTemplateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  containerId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  warehouseId!: string;

  @ApiPropertyOptional({ description: 'Transfer notes; defaults to "Template: <name>".' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
