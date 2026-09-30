"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Toggleable filter pill (aria-pressed). */
export function FilterChip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-chip border px-3 text-xs font-medium whitespace-nowrap transition-colors",
        active
          ? "border-brand bg-brand/10 text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Clickable summary widget. */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  active,
  onClick,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "amber" | "red" | "sky";
  active?: boolean;
  onClick?: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-w-0 flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors hover:bg-accent/40",
        active && "border-brand ring-1 ring-brand",
      )}
    >
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-lg font-semibold tabular-nums",
          tone === "amber" && "text-amber-700 dark:text-amber-400",
          tone === "red" && "text-red-700 dark:text-red-400",
          tone === "sky" && "text-sky-700 dark:text-sky-300",
          loading && "animate-pulse text-muted-foreground",
        )}
      >
        {loading ? "—" : value}
      </span>
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </button>
  );
}

export function NoAccess({ what }: { what: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-lg font-medium">No access</h2>
      <p className="text-sm text-muted-foreground">You don&apos;t have permission to view {what}.</p>
    </div>
  );
}
