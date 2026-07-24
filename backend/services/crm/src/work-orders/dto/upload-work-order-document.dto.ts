import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadWorkOrderDocumentDto {
  @ApiProperty({ example: 'application/pdf', description: 'MIME type of the WO document.' })
  @IsString()
  @Matches(/^(image\/(jpeg|png|webp)|application\/pdf)$/, {
    message: 'contentType must be an image (jpeg/png/webp) or application/pdf',
  })
  contentType!: string;
}
