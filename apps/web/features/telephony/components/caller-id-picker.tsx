"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { formatPhone } from "@/lib/phone";
import type { OwnedNumber } from "../numbers-api";

/**
 * Which of the workspace's numbers the call goes out from.
 *
 * A plain select is fine for three numbers and unusable for thirty — and a
 * business that runs a number per market or per campaign ends up with thirty.
 * Searchable by the number itself and by the name it was bought under, which
 * is how people actually remember them ("the Marietta line").
 */
export function CallerIdPicker({
  numbers,
  value,
  onChange,
}: {
  numbers: OwnedNumber[];
  value?: string;
  onChange: (phoneNumber: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = numbers.find((n) => n.phoneNumber === value);

  return (
    <div className="relative flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Caller ID"
        className="flex h-8 w-full items-center justify-between gap-1 rounded-md border bg-transparent px-2 text-xs hover:bg-muted/50"
      >
        <span className="truncate text-foreground">
          {selected ? formatPhone(selected.phoneNumber) : "Caller ID"}
        </span>
        <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-lg border bg-popover shadow-md">
            <Command loop>
              <CommandInput autoFocus placeholder="Search numbers…" className="h-9" />
              <CommandList className="max-h-56">
                <CommandEmpty>No number matches.</CommandEmpty>
                <CommandGroup>
                  {numbers.map((n) => (
                    <CommandItem
                      key={n.sid}
                      // Both spellings, so "404555" and "+1 404-555" both hit.
                      value={`${n.friendlyName} ${n.phoneNumber} ${n.phoneNumber.replace(/\D/g, "")}`}
                      onSelect={() => {
                        onChange(n.phoneNumber);
                        setOpen(false);
                      }}
                      className="gap-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{formatPhone(n.phoneNumber)}</span>
                        {n.friendlyName && n.friendlyName !== n.phoneNumber ? (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {n.friendlyName}
                          </span>
                        ) : null}
                      </span>
                      {n.phoneNumber === value ? (
                        <Check className="ml-auto size-4 text-brand" />
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        </>
      ) : null}
    </div>
  );
}
