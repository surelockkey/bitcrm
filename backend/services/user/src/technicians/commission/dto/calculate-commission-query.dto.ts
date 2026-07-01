import { IsNumber, Min, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CalculateCommissionQueryDto {
  @ApiProperty({ example: 350, description: 'Deal total / revenue.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  revenue!: number;

  @ApiProperty({ example: 28 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tax!: number;

  @ApiProperty({ example: 45, description: 'Parts cost.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  partsCost!: number;

  @ApiProperty({ example: true, description: 'Whether the deal was paid by credit card.' })
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  paidByCard!: boolean;
}
