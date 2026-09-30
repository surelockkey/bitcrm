import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentTerms } from '@bitcrm/types';

export const DUE_DATE_BASES = ['invoice_created', 'job_created', 'job_scheduled'] as const;
export type DueDateBasis = (typeof DUE_DATE_BASES)[number];

export class ProfileAddressDto {
  @ApiProperty() @IsString() @MaxLength(200) street!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) unit?: string;
  @ApiProperty() @IsString() @MaxLength(100) city!: string;
  @ApiProperty() @IsString() @MaxLength(50) state!: string;
  @ApiProperty() @IsString() @MaxLength(20) zip!: string;
  @ApiPropertyOptional({ example: 41.7658 }) @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @ApiPropertyOptional({ example: -72.6734 }) @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
}

/**
 * Every company field except `name`, all optional. `null` clears an optional
 * field (the service enforces that `name` never becomes empty).
 */
export class BusinessProfileFieldsDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(200) legalName?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsEmail() email?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(200) website?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(100) licenseNumber?: string | null;

  @ApiPropertyOptional({ type: ProfileAddressDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProfileAddressDto)
  address?: ProfileAddressDto | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Billing asset id of the logo (POST /assets, then PUT the bytes). 422 if the upload did not finish.',
  })
  @IsOptional()
  @IsString()
  logoAssetId?: string | null;

  @ApiPropertyOptional({ enum: PaymentTerms })
  @IsOptional()
  @IsEnum(PaymentTerms)
  defaultPaymentTerms?: PaymentTerms;

  @ApiPropertyOptional({ example: 45, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  defaultCustomTermDays?: number | null;

  @ApiPropertyOptional({ enum: DUE_DATE_BASES })
  @IsOptional()
  @IsIn(DUE_DATE_BASES as unknown as string[])
  dueDateBasis?: DueDateBasis;

  @ApiPropertyOptional({ description: 'Archived companies can no longer be picked for new jobs.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** `POST /business-profiles` — the first company becomes the default. */
export class CreateBusinessProfileDto extends BusinessProfileFieldsDto {
  @ApiProperty({ example: 'Sure Lock Key' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;
}

/** `PUT /business-profiles/:id` — partial. */
export class PatchBusinessProfileDto extends BusinessProfileFieldsDto {
  @ApiPropertyOptional({ example: 'Sure Lock Key' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;
}

/**
 * Compat `PUT /business-profile` (acts on the default company): `name` is
 * required as before; the other fields follow the same partial/null rules.
 */
export class UpdateBusinessProfileDto extends CreateBusinessProfileDto {}
