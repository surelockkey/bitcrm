/** `a,b` or `?x=a&x=b` → `['a', 'b']` — the report filters' list params. */
export const toList = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const arr = Array.isArray(value) ? value : String(value).split(',');
  return arr.map((v) => String(v).trim()).filter(Boolean);
};

/** A business day, YYYY-MM-DD. */
export const REPORT_DAY = /^\d{4}-\d{2}-\d{2}$/;
