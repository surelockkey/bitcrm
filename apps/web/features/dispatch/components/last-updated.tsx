"use client";

import { useEffect, useState } from "react";

/** Format ms-since-update as a short, human "updated N ago" phrase. */
export function formatUpdatedAge(ms: number): string {
  if (ms < 5_000) return "just now";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

/** Live "Updated N ago" label; re-renders every 5s off the query's timestamp. */
export function LastUpdated({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  if (!at) return <>not yet loaded</>;
  return <>Updated {formatUpdatedAge(Math.max(0, now - at))}</>;
}
