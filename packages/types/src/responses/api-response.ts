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
  /**
   * `null` when the list cannot be counted for this caller — the invoices and
   * estimates lists filter the page after the query for a technician scoped to
   * their own jobs, so no index walk answers the question. The panel then
   * shows "Page 2" and no "of N", exactly as the jobs tabs already do for a
   * closed status with no date window.
   */
  total: number | null;
  atLeast: boolean;
}
