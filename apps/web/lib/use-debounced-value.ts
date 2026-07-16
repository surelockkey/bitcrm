import { useEffect, useState } from "react";

/**
 * Returns `value` delayed by `delayMs` — updates only after the input has been
 * stable for that long. Used to avoid firing a search request on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
