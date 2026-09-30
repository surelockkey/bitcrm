"use client";

import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function DocField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * An input that keeps a local draft and commits on blur / Enter — so typing a
 * date segment by segment doesn't fire a save per keystroke.
 */
export function CommitInput({
  value,
  onCommit,
  className,
  ...rest
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "onBlur"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const draft = useSyncedDraft(value);
  const commit = () => {
    if (draft.value !== value) onCommit(draft.value);
  };
  return (
    <Input
      {...rest}
      value={draft.value}
      onChange={(e) => draft.set(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") draft.set(value);
      }}
      className={cn("h-8", className)}
    />
  );
}

/** Notes that save when the field loses focus. */
export function CommitTextarea({
  value,
  onCommit,
  ...rest
}: Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange" | "onBlur"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const draft = useSyncedDraft(value);
  return (
    <Textarea
      {...rest}
      value={draft.value}
      onChange={(e) => draft.set(e.target.value)}
      onBlur={() => {
        if (draft.value.trim() !== value.trim()) onCommit(draft.value.trim());
      }}
    />
  );
}

/** Local draft that resets whenever the saved value changes underneath it. */
function useSyncedDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  if (saved !== value) {
    setSaved(value);
    setDraft(value);
  }
  return { value: saved !== value ? value : draft, set: setDraft };
}
