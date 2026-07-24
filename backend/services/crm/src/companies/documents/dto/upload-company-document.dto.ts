import { IsEnum, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CompanyDocumentType } from '@bitcrm/types';

export class UploadCompanyDocumentDto {
  @ApiProperty({ enum: CompanyDocumentType, example: CompanyDocumentType.W9 })
  @IsEnum(CompanyDocumentType)
  docType!: CompanyDocumentType;

  @ApiProperty({ example: 'application/pdf', description: 'MIME type of the file to upload.' })
  @IsString()
  @Matches(/^(image\/(jpeg|png|webp)|application\/pdf)$/, {
    message: 'contentType must be an image (jpeg/png/webp) or application/pdf',
  })
  contentType!: string;
}
