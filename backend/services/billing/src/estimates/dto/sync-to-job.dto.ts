import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Workiz "This job already has items. Please select how you want to proceed". */
export class SyncToJobDto {
  @ApiPropertyOptional({
    enum: ['replace', 'append'],
    default: 'replace',
    description: '`replace`: "Replace existing job items". `append`: "Add to existing job items".',
  })
  @IsOptional()
  @IsIn(['replace', 'append'])
  mode?: 'replace' | 'append';
}
