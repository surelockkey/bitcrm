import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAttachmentDto {
  @ApiPropertyOptional({ example: 'front door before repair.jpg' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName?: string;

  @ApiPropertyOptional({ example: 'Broken latch, photo taken before the repair.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
