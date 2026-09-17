import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetProductTaxableDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  taxable!: boolean;
}
