"use client";

import { LibraryBig } from "lucide-react";
import type { AutomationTemplate } from "../templates";

/**
 * The Library tab (Workiz "ready-made recipes"). Placeholder: the sections
 * and the recipes land with the library stream — this only holds the shape
 * the page calls it with.
 */
export function AutomationLibrary({
  canEdit: _canEdit,
  search: _search,
  onUse: _onUse,
}: {
  canEdit: boolean;
  search?: string;
  onUse: (template: AutomationTemplate) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
      <LibraryBig className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">No recipes yet</p>
      <p className="text-sm text-muted-foreground">
        Ready-made automations land here. Create one of your own in the meantime.
      </p>
    </div>
  );
}
