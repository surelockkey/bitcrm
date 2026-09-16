"use client";

import { useState } from "react";
import { Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ShortCode, ShortCodeGroup } from "../api";
import { useShortCodes } from "../hooks";

const GROUP_LABEL: Record<ShortCodeGroup, string> = {
  client: "Client",
  job: "Job",
  technician: "Technician",
  business: "Business",
  links: "Links",
  custom: "Custom fields",
};
const GROUP_ORDER: ShortCodeGroup[] = ["client", "job", "technician", "business", "links", "custom"];

/**
 * `{{first_name}}`, `{{job_date}}`, `{{confirm_link}}`… — the Workiz short
 * codes, inserted at the caret. They are filled in by the server when the
 * message is sent (or previewed), never guessed here.
 */
export function ShortCodeMenu({
  onInsert,
  disabled,
  compact,
}: {
  onInsert: (code: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data: codes, isLoading } = useShortCodes(open);

  const grouped = new Map<ShortCodeGroup, ShortCode[]>();
  for (const c of codes ?? []) grouped.set(c.group, [...(grouped.get(c.group) ?? []), c]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? "icon-sm" : "sm"}
          className="gap-1.5 text-muted-foreground"
          disabled={disabled}
          aria-label="Insert a short code"
        >
          <Braces className="size-3.5" />
          {compact ? null : "Short codes"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
        {isLoading ? (
          <DropdownMenuLabel className="text-muted-foreground">Loading…</DropdownMenuLabel>
        ) : null}
        {GROUP_ORDER.filter((g) => grouped.has(g)).map((g, i) => (
          <div key={g}>
            {i > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{GROUP_LABEL[g]}</DropdownMenuLabel>
            {grouped.get(g)!.map((c) => (
              <DropdownMenuItem key={c.code} onSelect={() => onInsert(`{{${c.code}}}`)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">{`{{${c.code}}}`}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {c.description}
                    {c.example ? ` · e.g. ${c.example}` : ""}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
