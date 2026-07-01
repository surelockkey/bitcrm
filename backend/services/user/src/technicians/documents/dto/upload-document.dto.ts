import { IsEnum, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const DOCUMENT_TYPES = [
  'drivers_license_front',
  'drivers_license_back',
  'profile_photo',
  'bank_document',
] as const;

export class UploadDocumentDto {
  @ApiProperty({ enum: DOCUMENT_TYPES, example: 'drivers_license_front' })
  @IsEnum(DOCUMENT_TYPES)
  docType!: (typeof DOCUMENT_TYPES)[number];

  @ApiProperty({ example: 'image/jpeg', description: 'MIME type of the file to be uploaded.' })
  @IsString()
  @Matches(/^(image\/(jpeg|png|webp)|application\/pdf)$/, {
    message: 'contentType must be an image (jpeg/png/webp) or application/pdf',
  })
  contentType!: string;
}
