import { IsIn, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DocumentDiscountDto {
  @ApiProperty({ enum: ['amount', 'percent'], example: 'percent' })
  @IsIn(['amount', 'percent'])
  type!: 'amount' | 'percent';

  @ApiProperty({ example: 10, description: 'Dollars for `amount`; 0–100 for `percent`.' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  value!: number;
}
