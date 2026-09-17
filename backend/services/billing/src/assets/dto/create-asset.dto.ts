import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ALLOWED_ASSET_TYPES, MAX_ASSET_BYTES } from '../assets.service';

export class CreateAssetDto {
  @ApiProperty({ enum: ALLOWED_ASSET_TYPES })
  @IsIn(ALLOWED_ASSET_TYPES as unknown as string[])
  contentType!: string;

  @ApiPropertyOptional({ example: 'logo.png' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fileName?: string;

  @ApiPropertyOptional({ example: 20480, maximum: MAX_ASSET_BYTES })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_ASSET_BYTES)
  size?: number;
}
