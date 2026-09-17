import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { DocumentDiscountDto } from './document-discount.dto';

export class SetDealDiscountDto {
  @ApiProperty({ type: DocumentDiscountDto, nullable: true, description: 'Null removes the discount.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DocumentDiscountDto)
  discount!: DocumentDiscountDto | null;
}
