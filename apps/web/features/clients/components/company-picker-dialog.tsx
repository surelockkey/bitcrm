"use client";

import { Building2 } from "lucide-react";
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

/** Searchable modal to attach a contact to a company. */
export function CompanyPickerDialog({
  open,
  onOpenChange,
  companies,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companies: Company[];
  onSelect: (companyId: string) => void;
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Attach to company"
      description="Search your companies and pick one to attach."
    >
      <Command>
        <CommandInput placeholder="Search companies…" />
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
      </Command>
    </CommandDialog>
  );
}
