import { IsString, IsOptional, IsBoolean, IsInt, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Hand-written rather than PartialType(CreateJobTypeDto) to match the
 * service-area DTO style, where Swagger documents each field's update rule.
 */
export class UpdateJobTypeDto {
  @ApiPropertyOptional({ example: 'Lock Change' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Set false to archive: the type leaves every picker but still resolves on old deals.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
