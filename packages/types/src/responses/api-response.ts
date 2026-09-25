export interface ApiResponse<T> {
  success: true;
  data: T;
}

export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: {
    nextCursor?: string;
    count: number;
  };
}

/**
 * How many rows a list holds — the number behind "Page 2 of 7".
 *
 * Counting a cursor-paged list means walking it, so the walk is bounded: by a
 * ceiling on the tally, and by a ceiling on the reads spent. Either one makes
 * the answer a floor, which `atLeast` reports and the panel renders as `7+`.
 */
export interface ListCount {
  total: number;
  atLeast: boolean;
}
