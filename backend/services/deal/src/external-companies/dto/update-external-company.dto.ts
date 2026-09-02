import { IsString, IsOptional, IsBoolean, IsEmail, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Hand-written rather than PartialType(CreateExternalCompanyDto) to match the
 * catalog DTO style, where Swagger documents each field's update rule.
 */
export class UpdateExternalCompanyDto {
  @ApiPropertyOptional({ example: 'Allied Dispatch Solutions' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ example: 'Tammy.Killen@allieddispatch.com', description: 'Empty string clears it.' })
  @IsOptional()
  @Transform(trim)
  // "" clears the field; anything else must be a real address (create-parity).
  @ValidateIf((o) => !!o.email)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '500 Borla Dr, Johnson City, TN 37604', description: 'Empty string clears it.' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  address?: string;

  @ApiPropertyOptional({ example: '(855) 281-0219', description: 'Empty string clears it.' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  phone?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'false = Disabled: leaves every picker but still resolves on old jobs.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
