"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * One icon button in an inventory row's Actions cell, Workiz-style: the icon,
 * a one-word tooltip, and an accessible name that says which row it acts on.
 */
export function RowIconAction({
  label,
  tip,
  onClick,
  children,
}: {
  label: string;
  tip: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
