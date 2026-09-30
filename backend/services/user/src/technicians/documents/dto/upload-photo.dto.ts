import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** The card's photo: an image, and nothing else — a PDF cannot be drawn in an avatar. */
export const PHOTO_CONTENT_TYPE = /^image\/(jpeg|png|webp)$/;

export class UploadPhotoDto {
  @ApiProperty({ example: 'image/jpeg', description: 'MIME type of the image to be uploaded.' })
  @IsString()
  @Matches(PHOTO_CONTENT_TYPE, { message: 'contentType must be an image (jpeg/png/webp)' })
  contentType!: string;
}
