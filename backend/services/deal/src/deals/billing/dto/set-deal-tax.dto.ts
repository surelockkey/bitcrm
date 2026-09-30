import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetDealTaxDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'tax-rate-uuid',
    description: 'Active catalog tax rate, or null for no tax. Either way the job becomes `taxSource: manual`.',
  })
  // IsOptional lets an explicit null through; the service rejects a missing key.
  @IsOptional()
  @IsString()
  taxRateId!: string | null;
}
