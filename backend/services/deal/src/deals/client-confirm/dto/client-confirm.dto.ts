import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { ClientConfirmRequest } from '@bitcrm/types';

/** Body of `POST /deals/internal/:id/client-confirm` (billing → deal): how the client confirmed. */
export class ClientConfirmDto implements ClientConfirmRequest {
  @ApiProperty({ enum: ['link'], description: 'The page `{{confirm_link}}` opens — the only way today.' })
  @IsIn(['link'])
  via!: 'link';

  @ApiPropertyOptional({ example: '203.0.113.9', description: "The client's address, kept on the history line." })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;

  @ApiPropertyOptional({ description: "The client's browser, kept on the history line." })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;
}
