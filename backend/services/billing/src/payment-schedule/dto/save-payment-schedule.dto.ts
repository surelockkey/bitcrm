import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PAYMENT_SCHEDULE_METHODS, type PaymentScheduleMethod } from '@bitcrm/types';
import { MAX_SCHEDULED_PAYMENTS } from '../payment-schedule.rules';

export class PaymentScheduleEntryDto {
  @ApiPropertyOptional({ description: 'Kept to keep a payment the same payment across edits; absent ⇒ a new one.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @ApiPropertyOptional({ description: "With method `percent`: the share of the job total." })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  percent?: number;

  @ApiPropertyOptional({ description: 'With method `amount`: dollars.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  amount?: number;

  @ApiProperty({ example: '2026-10-06' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SavePaymentScheduleDto {
  @ApiProperty({ enum: PAYMENT_SCHEDULE_METHODS })
  @IsIn(PAYMENT_SCHEDULE_METHODS)
  method!: PaymentScheduleMethod;

  @ApiProperty({ type: [PaymentScheduleEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SCHEDULED_PAYMENTS)
  @ValidateNested({ each: true })
  @Type(() => PaymentScheduleEntryDto)
  entries!: PaymentScheduleEntryDto[];
}
