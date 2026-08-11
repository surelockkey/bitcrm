"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { CalendarEventType, type User } from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateCalendarEvent } from "../hooks";
import { calendarEventSchema, toEventInput } from "../schemas";
import { eventLabel } from "../lib";

const TYPES = [
  CalendarEventType.TIME_OFF,
  CalendarEventType.LUNCH,
  CalendarEventType.BREAK,
  CalendarEventType.APPOINTMENT,
];

export function TimeOffDialog({
  open,
  onOpenChange,
  techIds,
  users,
  defaultTechId,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  techIds: string[];
  users: Map<string, User>;
  defaultTechId?: string;
  defaultDate: string;
}) {
  const create = useCreateCalendarEvent();
  const [techId, setTechId] = useState(defaultTechId ?? techIds[0] ?? "");
  const [type, setType] = useState<CalendarEventType>(CalendarEventType.TIME_OFF);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [allDay, setAllDay] = useState(true);
  const [timeSlot, setTimeSlot] = useState("");
  const [error, setError] = useState<string | null>(null);

  const techName = (id: string) => {
    const u = users.get(id);
    return u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email : id;
  };

  const submit = () => {
    setError(null);
    const parsed = calendarEventSchema.safeParse({ type, title, startDate, endDate, allDay, timeSlot });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    if (!techId) {
      setError("Pick a technician");
      return;
    }
    create.mutate(
      { techId, body: toEventInput(parsed.data) },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add time off</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Technician</Label>
              <Select value={techId} onValueChange={setTechId}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {techIds.map((id) => (
                    <SelectItem key={id} value={id}>{techName(id)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as CalendarEventType)}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{eventLabel(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="to-title">Title</Label>
            <Input id="to-title" className="h-10" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vacation" />
          </div>

          <label className="flex items-center gap-2">
            <Switch checked={allDay} onCheckedChange={setAllDay} />
            <span className="text-sm">All day{allDay ? " (may span multiple days)" : ""}</span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="to-start">Start</Label>
              <Input id="to-start" type="date" className="h-10" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            {allDay ? (
              <div className="space-y-1.5">
                <Label htmlFor="to-end">End</Label>
                <Input id="to-end" type="date" className="h-10" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="to-slot">Time</Label>
                <Input id="to-slot" className="h-10 font-mono" value={timeSlot} onChange={(e) => setTimeSlot(e.target.value)} placeholder="12:00-13:00" />
              </div>
            )}
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="brand" className="gap-1.5" disabled={create.isPending} onClick={submit}>
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
