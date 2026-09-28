import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { JobsByStatusQueryDto } from '../dto/jobs-by-status-query.dto';

/**
 * A dashboard widget's window, plus the card's refresh button. Declared here
 * rather than read off the raw query: deal-service's ValidationPipe strips any
 * property a DTO does not name.
 */
export class WidgetWindowQueryDto extends JobsByStatusQueryDto {
  @ApiPropertyOptional({
    enum: ['1', 'true'],
    description: 'Rebuild the snapshot now instead of reading the nightly one.',
  })
  @IsOptional()
  @IsIn(['1', 'true'])
  refresh?: string;
}

/** The window alone, and whether to rebuild — what the service takes. */
export function splitRefresh(query: WidgetWindowQueryDto): {
  window: { from: string; to: string };
  opts: { fresh: boolean };
} {
  return {
    window: { from: query.from, to: query.to },
    opts: { fresh: query.refresh === '1' || query.refresh === 'true' },
  };
}
