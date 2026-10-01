import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { DOCUMENT_NOTES_MAX_LENGTH } from '@bitcrm/types';

/** Every field optional: a PATCH-shaped PUT, merged over what is stored. */
export class UpdateDocumentSettingsDto {
  @ApiPropertyOptional({ example: 'Thank you for considering our services!', description: 'Pre-filled Notes on a new estimate. Empty = none.' })
  @IsOptional()
  @IsString()
  @MaxLength(DOCUMENT_NOTES_MAX_LENGTH)
  estimateNotes?: string;

  @ApiPropertyOptional({ example: 'Thank you for considering our services!', description: 'Pre-filled Notes on a new invoice. Empty = none.' })
  @IsOptional()
  @IsString()
  @MaxLength(DOCUMENT_NOTES_MAX_LENGTH)
  invoiceNotes?: string;

  @ApiPropertyOptional({ example: 50, nullable: true, description: 'Default deposit as a percent of the total. `null` clears the default deposit.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  depositPercentage?: number | null;

  @ApiPropertyOptional({ example: 75, nullable: true, description: 'Default deposit as a fixed amount. `null` clears the default deposit.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  depositAmount?: number | null;

  @ApiPropertyOptional({ description: '"Request signature" pre-checked when sending an invoice.' })
  @IsOptional()
  @IsBoolean()
  requestInvoiceSignature?: boolean;

  @ApiPropertyOptional({ description: 'Keep the other options of a proposal visible after the client picks one.' })
  @IsOptional()
  @IsBoolean()
  showUnselectedProposalOptions?: boolean;

  @ApiPropertyOptional({ example: 'Your invoice from {{business.name}}', maxLength: 250 })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  invoiceEmailSubject?: string;

  @ApiPropertyOptional({ description: 'Must keep {{portal_link}}.', maxLength: DOCUMENT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(DOCUMENT_NOTES_MAX_LENGTH)
  invoiceMessage?: string;

  @ApiPropertyOptional({ example: 'Your estimate from {{business.name}}', maxLength: 250 })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  estimateEmailSubject?: string;

  @ApiPropertyOptional({ description: 'Must keep {{portal_link}}.', maxLength: DOCUMENT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(DOCUMENT_NOTES_MAX_LENGTH)
  estimateMessage?: string;

  @ApiPropertyOptional({ example: 'View your proposal from {{business.name}}', maxLength: 250 })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  proposalEmailSubject?: string;

  @ApiPropertyOptional({ description: 'Must keep {{portal_link}}.', maxLength: DOCUMENT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(DOCUMENT_NOTES_MAX_LENGTH)
  proposalMessage?: string;
}
