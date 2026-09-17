import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEstimateDto {
  @ApiProperty({ example: 'deal-uuid' })
  @IsString()
  @IsNotEmpty()
  dealId!: string;

  @ApiPropertyOptional({ example: 'Good', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: "Start with a copy of the job's current items." })
  @IsOptional()
  @IsBoolean()
  copyJobItems?: boolean;
}
