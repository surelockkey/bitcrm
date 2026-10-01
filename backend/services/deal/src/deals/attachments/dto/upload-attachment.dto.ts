import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UploadAttachmentDto {
  @ApiProperty({ example: 'before-job.jpg' })
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({
    example: 'image/jpeg',
    description:
      'MIME type of the file to upload: image/jpeg|png|webp|heic, application/pdf, ' +
      'application/vnd.openxmlformats-officedocument.* (docx/xlsx/pptx) or video/mp4.',
  })
  @IsString()
  @Matches(/^(image\/(jpeg|png|webp|heic)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.[a-z]+(\.[a-z]+)*|video\/mp4)$/, {
    message:
      'contentType must be an image (jpeg/png/webp/heic), application/pdf, an Office document (application/vnd.openxmlformats-officedocument.*) or video/mp4',
  })
  contentType!: string;

  @ApiPropertyOptional({ example: 1048576, description: 'File size in bytes.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  size?: number;

  @ApiPropertyOptional({ example: 'before', description: 'Optional grouping label (before/after/parts/check/…).' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;
}
