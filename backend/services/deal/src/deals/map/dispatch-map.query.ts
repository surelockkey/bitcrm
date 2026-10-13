import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { CLOSED_SUPER_STATUSES, JobSuperStatus, SUPER_STATUS_ORDER } from '@bitcrm/types';

/** The date box's widest span — a calendar month. */
export const DISPATCH_MAP_MAX_DAYS = 31;

/** The statuses a job is still alive in: what the map holds whatever the date. */
export const DISPATCH_MAP_OPEN_STATUSES: readonly JobSuperStatus[] = SUPER_STATUS_ORDER.filter(
  (s) => !CLOSED_SUPER_STATUSES.has(s),
);

/**
 * `GET /deals/map`. Every field is declared so the global `whitelist` keeps
 * it; the values are read by `parseDispatchMapQuery`, which owns the rules.
 */
export class DispatchMapQueryDto {
  @ApiPropertyOptional({
    description:
      'Super-statuses, comma-separated or repeated. Default: the four open ones (submitted, in_progress, pending, ' +
      'done_pending_approval) — each read whole whatever its date unless `from` is given. `done` / `canceled` need `from`.',
  })
  @IsOptional()
  statuses?: string | string[];

  @ApiPropertyOptional({
    description:
      'First visit day read, YYYY-MM-DD. Bounds every status asked (open ones too — undated jobs are then left ' +
      'out); without it the open statuses are read whole.',
  })
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({
    description: `Last visit day, inclusive (default: \`from\`). At most ${DISPATCH_MAP_MAX_DAYS} days.`,
  })
  @IsOptional()
  to?: string;
}

/** What the map reads: these statuses, the closed ones only for these days. */
export interface DispatchMapRead {
  /** In the board's order (`SUPER_STATUS_ORDER`), once each. */
  statuses: JobSuperStatus[];
  /** Visit days, inclusive. Narrows every status read; without it the open ones are read whatever their date. */
  window?: { from: string; to: string };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD that names a real calendar day, as a UTC midnight. */
function day(value: string, name: string): number {
  const at = Date.parse(`${value}T00:00:00Z`);
  if (!DAY.test(value) || Number.isNaN(at) || new Date(at).toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${name} must be a day, YYYY-MM-DD`);
  }
  return at;
}

/**
 * The dispatch map's question. Open statuses by default; a status list is
 * taken comma-separated or repeated, checked against the super-statuses and
 * put in the board's order. Done and Canceled are hundreds of thousands of
 * rows after the import, so they are only ever read for a window of at most
 * a month (`from`..`to`, `to` defaulting to `from`). A window narrows the
 * open statuses as well — the board asks for the days it shows.
 */
export function parseDispatchMapQuery(query: DispatchMapQueryDto): DispatchMapRead {
  const raw = (Array.isArray(query.statuses) ? query.statuses : [query.statuses ?? ''])
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  for (const s of raw) {
    if (!SUPER_STATUS_ORDER.includes(s as JobSuperStatus)) throw new BadRequestException(`Unknown status: ${s}`);
  }
  const statuses = raw.length
    ? SUPER_STATUS_ORDER.filter((s) => raw.includes(s))
    : [...DISPATCH_MAP_OPEN_STATUSES];

  let window: DispatchMapRead['window'];
  if (query.from) {
    const to = query.to || query.from;
    const span = (day(to, 'to') - day(query.from, 'from')) / 86_400_000 + 1;
    if (span < 1) throw new BadRequestException('`to` must be on or after `from`');
    if (span > DISPATCH_MAP_MAX_DAYS) {
      throw new BadRequestException(`The window is limited to ${DISPATCH_MAP_MAX_DAYS} days`);
    }
    window = { from: query.from, to };
  } else if (query.to) {
    throw new BadRequestException('`to` needs a `from`');
  }

  if (!window && statuses.some((s) => CLOSED_SUPER_STATUSES.has(s))) {
    throw new BadRequestException('Done and Canceled are read for a window of days: give `from` (and `to`)');
  }
  return window ? { statuses, window } : { statuses };
}
