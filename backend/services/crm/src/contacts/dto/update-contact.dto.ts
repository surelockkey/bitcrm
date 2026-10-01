import {
  IsInt, Min,
  IsString, IsOptional, IsBoolean, MaxLength, IsEnum, IsArray, IsObject,
  ArrayMinSize, ArrayMaxSize, MinLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ContactType } from '@bitcrm/types';
import { PaymentTerms } from '@bitcrm/types';
import { ContactAddressDto } from './address.dto';
import { MAX_CONTACT_ADDRESSES } from './create-contact.dto';

export class UpdateContactDto {
  @ApiPropertyOptional({ example: 'Jane' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Smith' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @ApiPropertyOptional({ example: ['(404) 555-1234'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  phones?: string[];

  @ApiPropertyOptional({
    example: { '+14045551234': '102' },
    description:
      'What to press once the call is answered, keyed by the number it ' +
      'belongs to. Keys are re-normalized server-side and entries for ' +
      'numbers not on the record are dropped.',
  })
  @IsOptional()
  @IsObject()
  phoneExtensions?: Record<string, string>;

  @ApiPropertyOptional({ example: ['jane@example.com'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  emails?: string[];

  @ApiPropertyOptional({ type: [ContactAddressDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CONTACT_ADDRESSES, {
    message: `A contact can hold at most ${MAX_CONTACT_ADDRESSES} addresses`,
  })
  @ValidateNested({ each: true })
  @Type(() => ContactAddressDto)
  addresses?: ContactAddressDto[];

  @ApiPropertyOptional({ type: ContactAddressDto, description: 'Where invoices go, when not the service address' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContactAddressDto)
  billingAddress?: ContactAddressDto;

  @ApiPropertyOptional({ type: [String], description: 'Client tags (ClientTag catalog ids)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @ApiPropertyOptional({ description: "Workiz's Ad source: a JobSource catalog id" })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional({ enum: PaymentTerms, description: "Workiz's Client payment terms; win over the company's on invoices" })
  @IsOptional()
  @IsEnum(PaymentTerms)
  paymentTerms?: PaymentTerms;

  @ApiPropertyOptional({ example: 60, description: 'Days for `custom` terms' })
  @IsOptional()
  @IsInt()
  @Min(1)
  customTermsDays?: number;

  @ApiPropertyOptional({ example: 'company-uuid' })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional({ enum: ContactType })
  @IsOptional()
  @IsEnum(ContactType)
  type?: ContactType;

  @ApiPropertyOptional({ example: 'Director' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'Updated notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Tax-exempt client: new jobs and estimates carry no tax.' + (''),
  })
  @IsOptional()
  @IsBoolean()
  taxExempt?: boolean;

  @ApiPropertyOptional({ example: 'Registered non-profit', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  taxExemptReason?: string;
}
