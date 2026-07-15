import { SearchMode, SearchType } from '@bitcrm/types';

/**
 * Raw query params. This repo does NOT run a transforming ValidationPipe on query
 * DTOs, so everything arrives as strings (or undefined) — coercion happens in the
 * service via `normalizeSearchQuery`, never via class-transformer.
 */
export class SearchQueryDto {
  q?: string;
  mode?: string;
  type?: string; // csv of SearchType
  limit?: string; // typeahead per-type
  page?: string; // full
  size?: string; // full
}

export interface NormalizedSearchQuery {
  q: string;
  mode: SearchMode;
  types?: SearchType[];
  perTypeLimit: number;
  page: number;
  size: number;
}

const VALID_TYPES = new Set<SearchType>([
  'deal', 'contact', 'company', 'user', 'technician',
  'product', 'warehouse', 'container', 'transfer', 'stock',
]);

const MAX_SIZE = 50;
const MAX_PER_TYPE = 10;

function toInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Coerce + clamp raw params into a safe, typed shape. */
export function normalizeSearchQuery(dto: SearchQueryDto): NormalizedSearchQuery {
  const q = (dto.q ?? '').trim();
  const mode: SearchMode = dto.mode === 'full' ? 'full' : 'typeahead';

  let types: SearchType[] | undefined;
  if (dto.type) {
    const parsed = dto.type
      .split(',')
      .map((t) => t.trim())
      .filter((t): t is SearchType => VALID_TYPES.has(t as SearchType));
    if (parsed.length > 0) types = parsed;
  }

  return {
    q,
    mode,
    types,
    perTypeLimit: Math.min(MAX_PER_TYPE, toInt(dto.limit, 5)),
    page: toInt(dto.page, 1),
    size: Math.min(MAX_SIZE, toInt(dto.size, 20)),
  };
}
