import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { DiscountDto } from '../../common/dto/discount.dto';

export class UpdateEstimateDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string | null;

  @ApiPropertyOptional({ example: '2026-09-16' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'estimateDate must be YYYY-MM-DD' })
  estimateDate?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  templateId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Catalog tax rate (name + effective percent are snapshotted, source `manual`). `null` = no tax.',
  })
  @IsOptional()
  @IsString()
  taxRateId?: string | null;

  @ApiPropertyOptional({ type: DiscountDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountDto)
  discount?: DiscountDto | null;
}
