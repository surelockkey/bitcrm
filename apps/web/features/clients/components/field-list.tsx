"use client";

import type { ReactNode } from "react";
import { EyeOff } from "lucide-react";
import type { Phone } from "lucide-react";

/**
 * A labelled list of a client's phones, emails or addresses — the same block
 * on a person's record and a company's, which is why it lives here rather than
 * twice over.
 *
 * Values stay raw so an `action` (the call button) gets something it can dial;
 * `format` handles the reading.
 */
export function FieldList({
  label,
  icon: Icon,
  values,
  maskedCount,
  primaryFirst = false,
  format,
  action,
}: {
  label: string;
  icon: typeof Phone;
  values: string[];
  /**
   * How many values were withheld because the viewer lacks
   * `contacts.view_numbers`. A masked record arrives with an empty `values`
   * exactly like a client who has no phone at all, and the two must not read
   * the same — "—" would send somebody hunting for a number that is on file.
   */
  maskedCount?: number;
  /** Mark the first value as the primary one. */
  primaryFirst?: boolean;
  /** Display transform; the raw value still reaches `action`. */
  format?: (v: string) => string;
  /** Per-value control, rendered at the end of the row. */
  action?: (raw: string, index: number) => ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {values.length === 0 && maskedCount ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <EyeOff className="size-3.5 shrink-0" />
          {maskedCount} {maskedCount === 1 ? "number" : "numbers"}, hidden
        </p>
      ) : values.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <div className="space-y-1">
          {values.map((v, i) => (
            <div key={`${v}-${i}`} className="flex items-center gap-2 text-sm">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-mono text-[13px]">{format ? format(v) : v}</span>
              {primaryFirst && i === 0 ? (
                <span className="rounded-full border border-green-500/40 px-1.5 text-[10px] text-green-600 dark:text-green-500">
                  primary
                </span>
              ) : null}
              {action?.(v, i)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
