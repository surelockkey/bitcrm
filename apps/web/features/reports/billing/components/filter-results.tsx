"use client";

import { useState } from "react";
import { Popover } from "radix-ui";
import { Check, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface FilterGroup<K extends string> {
  heading: string;
  options: Array<{ key: K; label: string }>;
}

/**
 * Workiz's one grouped multi-select ("Filter results"): OR inside a group,
 * AND between groups. `label` names the button for a single list ("Tags").
 */
export function FilterResults<K extends string>({
  groups,
  selected,
  onToggle,
  label = "Filter results",
  placeholder = `${label}…`,
}: {
  groups: FilterGroup<K>[];
  selected: K[];
  onToggle: (key: K) => void;
  label?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5" aria-label={label}>
          <ListFilter className="size-3.5" /> {label}
          {selected.length ? <span className="text-muted-foreground">({selected.length})</span> : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50 w-72 rounded-xl border bg-popover p-0 text-popover-foreground shadow-md">
          <Command loop>
            <CommandInput autoFocus placeholder={placeholder} className="h-9" />
            <CommandList className="max-h-[min(22rem,var(--radix-popover-content-available-height))]">
              <CommandEmpty>Nothing matches.</CommandEmpty>
              {groups.map((g) => (
                <CommandGroup key={g.heading} heading={g.heading}>
                  {g.options.map((o) => {
                    const on = selected.includes(o.key);
                    return (
                      <CommandItem
                        key={o.key}
                        value={`${g.heading} ${o.label} ${o.key}`}
                        onSelect={() => onToggle(o.key)}
                        aria-selected={on}
                        data-checked={on || undefined}
                      >
                        <span className={cn("flex size-4 items-center justify-center rounded-sm border", on && "border-primary bg-primary text-primary-foreground")}>
                          {on ? <Check className="size-3" /> : null}
                        </span>
                        {o.label}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
