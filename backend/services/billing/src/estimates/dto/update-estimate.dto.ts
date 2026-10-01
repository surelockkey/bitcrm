import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
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

  @ApiPropertyOptional({
    example: 50,
    nullable: true,
    description: 'Workiz "Set deposit" as a percent of the total. Clears a fixed amount. `null` clears the deposit.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  depositPercentage?: number | null;

  @ApiPropertyOptional({
    example: 75,
    nullable: true,
    description: 'Workiz "Set deposit" as a fixed amount. Clears a percent. `null` clears the deposit.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  depositAmount?: number | null;

  @ApiPropertyOptional({ type: DiscountDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountDto)
  discount?: DiscountDto | null;
}
