import { IsString, IsOptional, IsBoolean, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateItemCategoryDto {
  @ApiPropertyOptional({ example: 'Locks' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Set false to archive: the category leaves pickers but stays on existing items.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
