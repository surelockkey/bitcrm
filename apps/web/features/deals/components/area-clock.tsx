"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { clockInTz, DEFAULT_TZ } from "@/lib/timezone";

/**
 * Live "It's 8:02 AM in <area>" clock, ticking each minute in the job's
 * timezone — the service area's when it has one, otherwise Connecticut.
 */
export function AreaClock({ tz = DEFAULT_TZ, areaName }: { tz?: string; areaName?: string }) {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Clock className="size-4" />
      It&apos;s <b className="font-semibold text-foreground">{clockInTz(now, tz)}</b>
      {areaName ? <> in {areaName}</> : null}
    </span>
  );
}
