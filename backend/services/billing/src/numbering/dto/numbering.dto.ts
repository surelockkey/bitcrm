import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DOCUMENT_NUMBER_MAX } from '@bitcrm/types';

/** Settings → Numbering: a counter left out is left alone. */
export class UpdateNumberingDto {
  @ApiPropertyOptional({
    example: 85427,
    description: 'What the next CLIENT invoice (one with no job) is numbered. Must be more than the last number handed out.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(DOCUMENT_NUMBER_MAX)
  nextInvoiceNumber?: number;

  @ApiPropertyOptional({
    example: 1142,
    description: 'What the next CLIENT estimate (one with no job) is numbered. Must be more than the last number handed out.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(DOCUMENT_NUMBER_MAX)
  nextEstimateNumber?: number;
}
