"use client";

import { useState } from "react";
import { Building2, Plus } from "lucide-react";
import type { Company } from "@bitcrm/types";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { clientTypeLabel } from "../lib";

/** Searchable modal to attach a contact to a company, or create a new one. */
export function CompanyPickerDialog({
  open,
  onOpenChange,
  companies,
  onSelect,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companies: Company[];
  onSelect: (companyId: string) => void;
  /** When given, offers to create a company from the typed name. */
  onCreate?: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const exists = companies.some((c) => c.title.toLowerCase() === typed.toLowerCase());
  const canCreate = Boolean(onCreate) && typed.length > 0 && !exists;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Attach to company"
      description="Search your companies and pick one, or create a new one."
    >
      <Command shouldFilter>
        <CommandInput placeholder="Search companies…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No companies found.</CommandEmpty>
          <CommandGroup>
            {companies.map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.title} ${c.address ?? ""}`}
                onSelect={() => onSelect(c.id)}
                className="gap-2"
              >
                <span className="flex size-6 flex-none items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Building2 className="size-3.5" />
                </span>
                <span className="flex-1 truncate">{c.title}</span>
                <span className="text-xs text-muted-foreground">{clientTypeLabel(c.clientType)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
        {canCreate ? (
          <button
            type="button"
            onClick={() => onCreate!(typed)}
            className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-sm font-medium text-brand hover:bg-muted/50"
          >
            <Plus className="size-4" /> Create &ldquo;{typed}&rdquo;
          </button>
        ) : null}
      </Command>
    </CommandDialog>
  );
}
