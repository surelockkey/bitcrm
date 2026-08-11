"use client";

import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { JOB_FIELDS } from "../fields";
import { useJobFieldsStore } from "../fields-store";

/** Toolbar dropdown that picks which Jobs-table columns are shown. */
export function FieldsMenu() {
  const visible = useJobFieldsStore((s) => s.visible);
  const toggle = useJobFieldsStore((s) => s.toggle);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <Columns3 className="size-4" /> Fields
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Show fields</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {JOB_FIELDS.map((f) => (
          <DropdownMenuCheckboxItem
            key={f.id}
            checked={visible[f.id]}
            onCheckedChange={() => toggle(f.id)}
            // Keep the menu open so several fields can be toggled in one go.
            onSelect={(e) => e.preventDefault()}
          >
            {f.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
