import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_SURCHARGE_PERCENT } from '@bitcrm/types';

/** Every field optional: a PATCH-shaped PUT, merged over what is stored. */
export class UpdatePaymentSettingsDto {
  @ApiPropertyOptional({ description: 'Master switch. Stays off until Stripe keys are configured.' })
  @IsOptional()
  @IsBoolean()
  onlinePaymentsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  cardEnabled?: boolean;

  @ApiPropertyOptional({ description: 'ACH. Cheaper, but can reverse days later.' })
  @IsOptional()
  @IsBoolean()
  bankEnabled?: boolean;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  bankMinimum?: number;

  @ApiPropertyOptional({ description: 'Let the client pay less than the full balance.' })
  @IsOptional()
  @IsBoolean()
  allowPartial?: boolean;

  @ApiPropertyOptional({
    example: 0,
    description:
      `0–${MAX_SURCHARGE_PERCENT}. Ships OFF: US card-network rules cap a surcharge at the lower of ` +
      'your processing rate or 3% (credit only), it is banned in CT/MA/ME/PR, capped at 2% in CO, and ' +
      'New York forbids revealing it after the customer has chosen a card.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_SURCHARGE_PERCENT)
  surchargePercent?: number;

  @ApiPropertyOptional({ example: 'Card processing fee' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  surchargeLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  tipsEnabled?: boolean;

  @ApiPropertyOptional({ example: [10, 15, 20] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsNumber({ maxDecimalPlaces: 2 }, { each: true })
  @Min(0, { each: true })
  @Max(100, { each: true })
  tipPresets?: number[];
}
