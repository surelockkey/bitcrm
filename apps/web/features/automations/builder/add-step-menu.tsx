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
 * meeting them for the first time.
 */
export const ADD_STEP_OPTIONS: Array<{
  kind: Exclude<ChainNodeKind, "trigger">;
  title: string;
  hint: string;
  Icon: typeof Filter;
}> = [
  { kind: "condition", title: "Only if …", hint: "checked before anything is sent", Icon: Filter },
  { kind: "send", title: "Send a message", hint: "a text, an email or both", Icon: MessageSquare },
  { kind: "add_tag", title: "Apply a tag", hint: "put a tag on the job", Icon: Tag },
  { kind: "change_sub_status", title: "Change the sub-status", hint: "move the job's status", Icon: ToggleRight },
  { kind: "webhook", title: "Post a webhook", hint: "hand the job to another system", Icon: Webhook },
  { kind: "wait", title: "Wait", hint: "hold the steps that follow", Icon: Clock },
];

/**
 * The "+" on the line between two cards (spec §4). Always drawn, never on
 * hover: a hover affordance is no affordance at all on a touch screen, and
 * this is the only way to add a step. It inserts exactly where it sits, and
 * says so in its name so the position is not something only sighted readers
 * can see.
 */
export function AddStepButton({
  label,
  hasWait,
  disabled,
  onAdd,
}: {
  /** The accessible name — where this "+" inserts ("Add a step after step 2, Only if"). */
  label: string;
  /** A rule holds one delay, so a second "Wait" is offered only to say why it cannot be added. */
  hasWait: boolean;
  disabled?: boolean;
  onAdd: (kind: Exclude<ChainNodeKind, "trigger">) => void;
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
      className="relative flex justify-center"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          shut();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground",
          "transition-colors hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <Plus className="size-3.5" />
      </button>

      {open ? (
        <div className="absolute top-full left-1/2 z-30 mt-1 w-72 -translate-x-1/2 overflow-hidden rounded-lg border bg-popover shadow-md">
          <Command loop>
            <CommandInput autoFocus placeholder="Search…" className="h-9" />
            <CommandList className="max-h-72">
              <CommandEmpty>No step by that name</CommandEmpty>
              <CommandGroup>
                {ADD_STEP_OPTIONS.map(({ kind, title, hint, Icon }) => {
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
                      className="items-start gap-2"
                    >
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
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
