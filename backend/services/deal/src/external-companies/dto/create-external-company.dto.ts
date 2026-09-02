import { IsString, IsOptional, IsBoolean, IsEmail, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateExternalCompanyDto {
  @ApiProperty({ example: 'Allied Dispatch Solutions' })
  @IsString()
  @Transform(trim)
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({
    example: 'Tammy.Killen@allieddispatch.com',
    description: 'Optional — the form sends "" for a blank field, which is accepted.',
  })
  @IsOptional()
  @Transform(trim)
  // Most of the catalog has no email, and the form posts "" for an untouched
  // field — validate the format only once something was actually typed.
  @ValidateIf((o) => !!o.email)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '500 Borla Dr, Johnson City, TN 37604' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  address?: string;

  @ApiPropertyOptional({ example: '(855) 281-0219' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  phone?: string;

  @ApiPropertyOptional({ example: true, description: 'Defaults to true (Enabled).' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
