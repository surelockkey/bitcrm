"use client";

import { useState } from "react";
import { InventoryStatus } from "@bitcrm/types";
import type { ContainerTemplate } from "@bitcrm/types";
import { WzReturnIcon, WzTrashIcon } from "@/components/workiz/icons";
import { usePermissions } from "@/features/auth/use-permissions";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import { WzConfirm } from "@/features/inventory/item-edit/wz";
import { useArchiveTemplate, useRestoreTemplate } from "../hooks";

/**
 * The row's last glyph, as Workiz's Locations draw theirs: the red trash
 * (Archive — BitCRM archives, Vans keep a template they use) or, on an
 * archived one, Restore. Edit and Apply have their own glyphs beside it.
 */
export function TemplateRowActions({ template }: { template: ContainerTemplate }) {
  const { can } = usePermissions();
  const archive = useArchiveTemplate();
  const restore = useRestoreTemplate();
  const [confirm, setConfirm] = useState(false);

  const isActive = template.status !== InventoryStatus.ARCHIVED;
  // A glyph that does nothing is worse than none.
  if (isActive ? !can("containers", "delete") : !can("containers", "edit")) return null;

  if (!isActive) {
    return (
      <RowIconAction label={`Restore ${template.name}`} tip="Restore" onClick={() => restore.mutate(template.id)}>
        <WzReturnIcon />
      </RowIconAction>
    );
  }

  return (
    <>
      <RowIconAction label={`Archive ${template.name}`} tip="Archive" tone="danger" onClick={() => setConfirm(true)}>
        <WzTrashIcon />
      </RowIconAction>
      <WzConfirm
        open={confirm}
        onOpenChange={setConfirm}
        title={`Archive “${template.name}”?`}
        confirmText="Archive"
        pending={archive.isPending}
        onConfirm={() => archive.mutate(template.id, { onSuccess: () => setConfirm(false) })}
        message="Vans that use it keep it; it leaves the pickers. You can restore it later from the Archived filter."
      />
    </>
  );
}
