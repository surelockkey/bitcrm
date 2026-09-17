import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, Max, Min } from 'class-validator';
import type { DocumentDiscount } from '@bitcrm/types';

export class DiscountDto implements DocumentDiscount {
  @ApiProperty({ enum: ['amount', 'percent'] })
  @IsIn(['amount', 'percent'])
  type!: 'amount' | 'percent';

  @ApiProperty({ example: 10, description: 'Dollars for `amount`, 0–100 for `percent`.' })
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  value!: number;
}
