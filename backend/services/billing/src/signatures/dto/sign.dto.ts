import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { DECLINE_REASON_MAX_LENGTH, SIGNATURE_MAX_BYTES, SIGNER_NAME_MAX_LENGTH } from '@bitcrm/types';

/** A signature from the canvas: the PNG as a data URL plus the typed name. */
export class SignDocumentDto {
  @ApiProperty({ example: 'data:image/png;base64,iVBORw0KGgo…', description: 'PNG/JPEG data URL, at most 512 KB.' })
  @IsString()
  // base64 inflates by 4/3 plus the prefix.
  @MaxLength(Math.ceil((SIGNATURE_MAX_BYTES * 4) / 3) + 64)
  imageDataUrl!: string;

  @ApiProperty({ example: 'Jane Client', description: 'The name typed by the signer.' })
  @IsString()
  @MaxLength(SIGNER_NAME_MAX_LENGTH)
  signedBy!: string;
}

export class DeclineEstimateDto {
  @ApiPropertyOptional({ example: 'Going with another company', maxLength: DECLINE_REASON_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(DECLINE_REASON_MAX_LENGTH)
  reason?: string;
}
