"use client";

import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/** [before, match, after] round the first case-insensitive occurrence of `query`. */
export function splitMatch(text: string, query: string): [string, string, string] {
  const q = query.trim();
  if (!q) return [text, "", ""];
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return [text, "", ""];
  return [text.slice(0, at), text.slice(at, at + q.length), text.slice(at + q.length)];
}

/**
 * The client-name search's dropdown (`div.sajComplete`, new_07_client_search):
 * hung straight under the text field, as wide as the column (the field
 * itself overhangs 2px), at most 400px tall, a #ccc rule along its bottom.
 * Put it inside the field's positioned wrapper (or any `relative` box).
 */
export function WzSuggestionList({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="listbox"
      data-slot="wz-suggestions"
      {...props}
      className={cn(
        "absolute top-full left-0 z-[10000] max-h-[400px] w-full overflow-y-auto border-b border-input bg-white",
        className,
      )}
    />
  );
}

export interface WzSuggestionProps extends Omit<ComponentProps<"div">, "title" | "onSelect"> {
  /** "Dustin Roselle (#388843)"; the part matching `query` is set in bold. */
  title: string;
  /** The grey second line: city or street. */
  subtitle?: ReactNode;
  /** The typed text. */
  query: string;
  /** The `+ Add new "…"` row: the typed text, bold, in quotes. */
  addNew?: boolean;
  /** Under the keyboard: the same #deebff as a hovered row. */
  active?: boolean;
  onSelect?: () => void;
}

/**
 * One row (`clientSuggestion`): its own 1px #ccc box (so neighbours show a
 * 2px line, as Workiz's do), padding 15px 10px, the title 16px #404040, the
 * subtitle 14px grey 10px under it; #deebff fill and edge when hovered.
 */
export function WzSuggestion({
  title,
  subtitle,
  query,
  addNew = false,
  active = false,
  onSelect,
  className,
  ...rest
}: WzSuggestionProps) {
  const [before, match, after] = splitMatch(title, query);
  return (
    <div
      role="option"
      aria-selected={active}
      data-active={active || undefined}
      {...rest}
      // The input keeps focus while a row is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onSelect?.()}
      className={cn(
        "cursor-pointer truncate border border-input px-2.5 py-[15px] text-[14px] leading-4 text-wz-strong",
        "hover:border-wz-option-focus hover:bg-wz-option-focus data-[active]:border-wz-option-focus data-[active]:bg-wz-option-focus",
        className,
      )}
    >
      <div className={cn("truncate text-[16px] leading-4", subtitle ? "mb-2.5" : undefined)}>
        {addNew ? (
          <>
            {title} &quot;<b className="font-bold text-wz-strong">{query}</b>&quot;
          </>
        ) : (
          <>
            {before}
            {match ? <b className="font-bold text-wz-strong">{match}</b> : null}
            {after}
          </>
        )}
      </div>
      {subtitle ? <div className="truncate text-[14px] leading-4 text-wz-placeholder">{subtitle}</div> : null}
    </div>
  );
}
