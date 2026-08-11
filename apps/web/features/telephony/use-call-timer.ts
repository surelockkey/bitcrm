"use client";

import { useEffect, useState } from "react";

/**
 * Live elapsed-time ticker from an epoch-ms or ISO start. Sub-hour renders
 * "mm:ss", above an hour "h:mm:ss". No start yet → "00:00".
 */
export function useCallTimer(startedAt?: number | string): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!startedAt) return "00:00";
  const startMs =
    typeof startedAt === "number" ? startedAt : new Date(startedAt).getTime();
  const s = Math.max(0, Math.floor((now - startMs) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}
