"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Filter, MessageSquare, Plus, Tag, ToggleRight, Webhook } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { ChainNodeKind } from "./types";

/**
 * What a step can be (spec §4). The order is Workiz's own menu order — check
 * first, then the thing to do, then the delay — and every row says what it is
 * for, because "Only if" and "Change the sub-status" mean nothing to somebody
 * meeting them for the first time. Each row wears a coloured 24px tile, as the
 * rows of Workiz's slot menus do (`DropDownOptions` optionIcon,
 * pg_automations_wz_22_trigger_open): blue, green, orange, purple — Workiz's
 * own four — and slate for ours.
 */
export const ADD_STEP_OPTIONS: Array<{
  kind: Exclude<ChainNodeKind, "trigger">;
  title: string;
  hint: string;
  Icon: typeof Filter;
  tile: string;
}> = [
  { kind: "condition", title: "Only if …", hint: "checked before anything is sent", Icon: Filter, tile: "bg-brand" },
  { kind: "send", title: "Send a message", hint: "a text, an email or both", Icon: MessageSquare, tile: "bg-wz-tag-success" },
  { kind: "add_tag", title: "Apply a tag", hint: "put a tag on the job", Icon: Tag, tile: "bg-[#f5ba45]" },
  { kind: "change_sub_status", title: "Change the sub-status", hint: "move the job's status", Icon: ToggleRight, tile: "bg-[#d574e4]" },
  { kind: "webhook", title: "Post a webhook", hint: "hand the job to another system", Icon: Webhook, tile: "bg-wz-slate" },
  { kind: "wait", title: "Wait", hint: "hold the steps that follow", Icon: Clock, tile: "bg-wz-outline" },
];

/**
 * A "+" of the chain (spec §4). `variant="gap"` is the small round one on the
 * dashed connector between two lines — always drawn, never on hover: a hover
 * affordance is no affordance at all on a touch screen. `variant="end"` is
 * Workiz's "(+) Add condition" under the last line (a 24px #fad400 disc, the
 * words 13px/19px 500 white), here adding any kind of step. Each inserts
 * exactly where it sits, and says so in its name.
 */
export function AddStepButton({
  label,
  hasWait,
  disabled,
  onAdd,
  variant = "gap",
  className,
}: {
  /** The accessible name — where this "+" inserts ("Add a step after step 2, Only if"). */
  label: string;
  /** A rule holds one delay, so a second "Wait" is offered only to say why it cannot be added. */
  hasWait: boolean;
  disabled?: boolean;
  onAdd: (kind: Exclude<ChainNodeKind, "trigger">) => void;
  variant?: "gap" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const shut = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div
      ref={box}
      className={cn("relative", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          shut();
        }
      }}
    >
      {variant === "end" ? (
        <button
          ref={trigger}
          type="button"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="group/add flex cursor-pointer items-center gap-1.5 text-[13px] leading-[19px] font-medium tracking-[0.4px] text-white outline-none focus-visible:ring-2 focus-visible:ring-wz-focus disabled:cursor-not-allowed disabled:text-wz-outline"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-foreground group-disabled/add:bg-wz-outline">
            <Plus className="size-4" strokeWidth={2} />
          </span>
          Add a step
        </button>
      ) : (
        <button
          ref={trigger}
          type="button"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex size-[18px] cursor-pointer items-center justify-center rounded-full bg-wz-outline text-[#3b4b52]",
            "transition-colors hover:bg-primary focus-visible:bg-primary focus-visible:outline-none aria-expanded:bg-primary",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <Plus className="size-3" strokeWidth={2.5} />
        </button>
      )}

      {open ? (
        // Workiz's DropDownMenu: 334px, white, 8px corners, its two-part shadow,
        // the search in a 64px band over a #dfe2e3 rule, 40px rows.
        <div className="absolute top-full left-0 z-30 mt-2 w-[334px] overflow-hidden rounded-[8px] bg-white pb-1 shadow-[0_0_4px_rgba(59,75,82,0.05),0_8px_16px_rgba(59,75,82,0.15)]">
          <Command loop>
            <div className="border-b border-border p-3">
              <CommandInput autoFocus placeholder="Search" className="h-10" />
            </div>
            <CommandList className="max-h-72">
              <CommandEmpty>No step by that name</CommandEmpty>
              <CommandGroup>
                {ADD_STEP_OPTIONS.map(({ kind, title, hint, Icon, tile }) => {
                  const taken = kind === "wait" && hasWait;
                  return (
                    <CommandItem
                      key={kind}
                      value={kind}
                      keywords={[title, hint]}
                      disabled={taken}
                      onSelect={() => {
                        if (taken) return;
                        onAdd(kind);
                        shut();
                      }}
                      className="items-start gap-2 px-3 py-2"
                    >
                      <span className={cn("mt-px flex size-6 shrink-0 items-center justify-center rounded-[4px] text-white", tile)}>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm leading-[21px] font-semibold text-foreground">{title}</span>
                        <span className="block truncate text-xs text-wz-outline-label">
                          {/* Said on the row rather than left out: a menu that
                              quietly drops "Wait" reads as a menu that lost it. */}
                          {taken ? "already in this rule — one wait per rule" : hint}
                        </span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      ) : null}
    </div>
  );
}
