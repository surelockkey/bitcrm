import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UploadAttachmentDto {
  @ApiProperty({ example: 'before-job.jpg' })
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ example: 'image/jpeg', description: 'MIME type of the file to upload.' })
  @IsString()
  @Matches(/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/, {
    message: 'contentType must be an image (jpeg/png/webp/heic) or application/pdf',
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
