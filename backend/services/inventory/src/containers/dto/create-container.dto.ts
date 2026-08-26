import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateContainerDto {
  @ApiProperty({ description: 'Container name, e.g. "Van 1"' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @ApiPropertyOptional({ description: 'Technician to assign right away' })
  @IsOptional()
  @IsString()
  technicianId?: string;

  @ApiPropertyOptional({ description: 'Display name of the assigned technician' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  technicianName?: string;
}
