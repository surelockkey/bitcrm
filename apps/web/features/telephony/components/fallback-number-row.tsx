"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TableCell, TableRow } from "@/components/ui/table";
import { WzButton } from "@/components/workiz/button";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzEditIcon, WzTrashIcon } from "@/components/workiz/icons";
import { WZ_GRID_CELL } from "@/components/workiz/local-grid";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { WzRowIconButton } from "@/components/workiz/phone-tab-parts";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { useSetFallbackNumber } from "../config-hooks";

/**
 * Workiz's "Fallback Number" — the first row of its Call flows grid
 * (pg_settings_phone_wz_flows): the words 14px/16px #404040 in the Name
 * cell, and in Actions an outline pill "Add" (21px tall, 15px in, 13px/600
 * ink, a 1px ink edge) while none is set. Set, the number stands in the
 * Numbers cell with the pencil and the bin the flows' rows have (Workiz's
 * set state was never captured: the account keeps it switched off).
 *
 * The number rings for a minute, from our own number, when a flow ends with
 * nobody answering, nobody can be reached, or nobody is online.
 */
export function FallbackNumberRow({
  number,
  canManage,
  columns,
}: {
  /** E.164, or absent — also on an API from before the fallback number. */
  number?: string | null;
  canManage: boolean;
  /** How many cells the grid has; the ones between Numbers and Actions stay empty. */
  columns: number;
}) {
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const save = useSetFallbackNumber();

  const actions = !canManage ? null : number ? (
    <span className="flex items-center gap-4">
      <WzRowIconButton label="Edit Fallback Number" onClick={() => setEditing(true)}>
        <WzEditIcon size={18} />
      </WzRowIconButton>
      <WzRowIconButton label="Remove Fallback Number" onClick={() => setRemoving(true)}>
        <WzTrashIcon size={19} />
      </WzRowIconButton>
    </span>
  ) : (
    <WzButton
      variant="secondary"
      size="regular"
      // Workiz's secondary "Add": 68×21, 0 15px, 13px/19px 600 ink.
      className="h-[21px] px-[15px] py-0"
      onClick={() => setEditing(true)}
    >
      Add
    </WzButton>
  );

  return (
    <>
      <TableRow data-slot="fallback-number-row" className="border-0">
        <TableCell className={WZ_GRID_CELL}>Fallback Number</TableCell>
        <TableCell className={WZ_GRID_CELL}>{number ? formatPhone(number) || number : null}</TableCell>
        {Array.from({ length: Math.max(0, columns - 3) }, (_, i) => (
          <TableCell key={i} className={WZ_GRID_CELL} />
        ))}
        <TableCell className={WZ_GRID_CELL}>{actions}</TableCell>
      </TableRow>

      {editing ? (
        <FallbackNumberModal
          initial={number ?? ""}
          saving={save.isPending}
          onClose={() => setEditing(false)}
          onSave={async (e164) => {
            await save.mutateAsync(e164);
            setEditing(false);
          }}
        />
      ) : null}

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the fallback number?</AlertDialogTitle>
            <AlertDialogDescription>
              A call whose flow ends with nobody answering will simply end. No flow is changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void save.mutateAsync(null).catch(() => undefined);
                setRemoving(false);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function FallbackNumberModal({
  initial,
  saving,
  onClose,
  onSave,
}: {
  initial: string;
  saving: boolean;
  onClose: () => void;
  onSave: (e164: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial ? formatPhone(initial) || initial : "");
  const e164 = normalizePhone(value);

  return (
    <WzFormModal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Fallback Number"
      description="When nobody answers by the end of a call flow — or nobody can be reached — the call rings this number for a minute, from your own number."
      onSave={() => {
        if (e164) void onSave(e164).catch(() => undefined);
      }}
      saving={saving}
      saveDisabled={!e164}
    >
      <WzOutlinedTextField label="Phone number" type="tel" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
    </WzFormModal>
  );
}
