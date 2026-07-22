import { IsString, IsOptional, IsBoolean, IsInt, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateJobSourceDto {
  @ApiProperty({ example: 'Google Ads' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ example: 10, description: 'Higher sorts first in pickers.' })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ example: true, description: 'Defaults to true.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
