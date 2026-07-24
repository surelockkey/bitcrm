"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { TechnicianProfile } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useUpdateProfile } from "@/features/technicians/hooks";
import { workingHoursSchema } from "../schemas";

const DAYS = [
  { i: 1, label: "Mon" },
  { i: 2, label: "Tue" },
  { i: 3, label: "Wed" },
  { i: 4, label: "Thu" },
  { i: 5, label: "Fri" },
  { i: 6, label: "Sat" },
  { i: 0, label: "Sun" },
];

/**
 * Manager-controlled working hours. Seeds Mon–Fri 08:00–17:00 on first open so
 * schedule dimming/conflicts start from a real default rather than nothing.
 */
export function WorkingHoursEditor({
  profile,
  readOnly,
}: {
  profile: TechnicianProfile;
  readOnly?: boolean;
}) {
  const update = useUpdateProfile();
  const [days, setDays] = useState<number[]>(profile.workingDays ?? [1, 2, 3, 4, 5]);
  const [start, setStart] = useState(profile.workStart ?? "08:00");
  const [end, setEnd] = useState(profile.workEnd ?? "17:00");
  const [error, setError] = useState<string | null>(null);

  const toggle = (i: number) =>
    setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()));

  const save = () => {
    setError(null);
    const parsed = workingHoursSchema.safeParse({ workingDays: days, workStart: start, workEnd: end });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the hours");
      return;
    }
    update.mutate({
      id: profile.userId,
      body: { workingDays: parsed.data.workingDays, workStart: parsed.data.workStart, workEnd: parsed.data.workEnd },
    });
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Working hours</div>
      <div className="flex flex-wrap gap-1.5">
        {DAYS.map((d) => (
          <button
            key={d.i}
            type="button"
            disabled={readOnly}
            onClick={() => toggle(d.i)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs",
              days.includes(d.i) ? "border-brand bg-brand/10 text-brand" : "text-muted-foreground",
              readOnly && "opacity-60",
            )}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="flex items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="wh-start">Start</Label>
          <Input id="wh-start" type="time" className="h-9 w-32" value={start} disabled={readOnly} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wh-end">End</Label>
          <Input id="wh-end" type="time" className="h-9 w-32" value={end} disabled={readOnly} onChange={(e) => setEnd(e.target.value)} />
        </div>
        {!readOnly ? (
          <Button variant="outline" size="sm" className="gap-1.5" disabled={update.isPending} onClick={save}>
            {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save hours
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
