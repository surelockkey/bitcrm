import { IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SetSensitiveDto {
  @ApiPropertyOptional({ example: '123-45-6789', description: 'SSN (stored KMS-encrypted).' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{3}-?\d{2}-?\d{4}$/, { message: 'ssn must be a valid SSN' })
  ssn?: string;

  @ApiPropertyOptional({ example: '000123456789', description: 'Bank account number (stored KMS-encrypted).' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4,17}$/, { message: 'bankAccount must be 4-17 digits' })
  bankAccount?: string;
}
