import { SearchType } from './search-document';

/** How the caller wants results shaped. */
export type SearchMode = 'typeahead' | 'full';

/** A single result line returned to the client. */
export interface SearchHit {
  entityId: string;
  type: SearchType;
  title: string;
  subtitle?: string;
  badges: string[];
  url?: string;
  /** Relevance score from the engine (higher = better). */
  score: number;
}

/** Hits of one entity type, plus the total matches of that type. */
export interface SearchGroup {
  type: SearchType;
  total: number;
  items: SearchHit[];
}

export interface SearchResponse {
  query: string;
  mode: SearchMode;
  /** Typeahead mode: top-N hits grouped by entity type. Empty in full mode. */
  groups: SearchGroup[];
  /** Full mode: the current page as a flat, relevance-ordered list. Absent in typeahead. */
  hits?: SearchHit[];
  /** Per-type match counts after authorization filtering (full mode). */
  facets?: Partial<Record<SearchType, number>>;
  /** Total matches across all types (full mode, for pagination). */
  total?: number;
  page?: number;
  size?: number;
  /** Engine round-trip in ms. */
  took: number;
}
