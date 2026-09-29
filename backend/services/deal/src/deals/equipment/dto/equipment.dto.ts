import { IsDateString, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Workiz's "Add equipment": a name and a model, the rest optional. */
export class CreateEquipmentDto {
  @ApiProperty({ example: 'Garage door opener' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'LM-8500' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  model!: string;

  @ApiPropertyOptional({ example: 'LiftMaster' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @ApiPropertyOptional({ example: '2027-09-29', description: 'Labor warranty valid through (YYYY-MM-DD).' })
  @IsOptional()
  @IsDateString()
  laborWarrantyUntil?: string;

  @ApiPropertyOptional({ example: '2031-09-29', description: 'Manufacturer warranty valid through (YYYY-MM-DD).' })
  @IsOptional()
  @IsDateString()
  manufacturerWarrantyUntil?: string;

  @ApiPropertyOptional({ example: 'SN-0042' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  serial?: string;

  @ApiPropertyOptional({ example: '2026-09-29', description: 'Installation date (YYYY-MM-DD).' })
  @IsOptional()
  @IsDateString()
  installedOn?: string;

  @ApiPropertyOptional({ example: '50 Fitch St, New Haven, CT 06515', description: 'Defaults to the job’s address.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  propertyAddress?: string;

  @ApiPropertyOptional({ example: 'Garage, left wall' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationInProperty?: string;

  @ApiPropertyOptional({ example: 'Replaced the logic board.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Any field of the form; `null` on an optional one clears it. Name and model can change but never go empty. */
export class UpdateEquipmentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) model?: string;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, v) => v !== null && v !== undefined) @IsString() @MaxLength(120) brand?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, v) => v !== null && v !== undefined) @IsDateString() laborWarrantyUntil?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, v) => v !== null && v !== undefined) @IsDateString() manufacturerWarrantyUntil?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, v) => v !== null && v !== undefined) @IsString() @MaxLength(120) serial?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, v) => v !== null && v !== undefined) @IsDateString() installedOn?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, v) => v !== null && v !== undefined) @IsString() @MaxLength(300) propertyAddress?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, v) => v !== null && v !== undefined) @IsString() @MaxLength(200) locationInProperty?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, v) => v !== null && v !== undefined) @IsString() @MaxLength(2000) notes?: string | null;
}
