"use client";

import { useState } from "react";

import { WzFormModal } from "@/components/workiz/form-modal";
import { OUTLINE } from "@/components/workiz/outlined";
import { ApiError, getApiErrorMessage } from "@/lib/api/errors";
import { formatPhone, isValidPhone, normalizePhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { useBlockCaller } from "../blocked-callers-hooks";

/**
 * Workiz's two boxes (feat_blocked_callers_wz_modal, `Input-module__input`):
 * 480×40, 1px #9ea6aa, 4px corners, 13px ink 12px in, a plain placeholder —
 * no floating label here, unlike the catalog modals' `WzModalTextField`.
 */
const INPUT = cn(
  OUTLINE,
  "block h-10 w-full px-3 py-[10.5px] text-[13px] leading-4 text-foreground outline-none",
  "placeholder:text-wz-outline-label focus:border-wz-link",
);

/**
 * Workiz's "Block a Number" modal (Phone → Blocked callers, and "Block this
 * number" on a call): 528px, the title, the number ("Block a Number"), the
 * reason ("I am blocking this number because..."), Cancel and Block. The
 * number is checked here before the server is asked; "already blocked" (409)
 * and any other refusal are shown in place.
 */
export function BlockNumberDialog({
  open,
  onOpenChange,
  initialNumber,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** E.164 (or any form) to start from — the call's other side. */
  initialNumber?: string;
}) {
  const block = useBlockCaller();
  // Callers mount the form only while it is open, so every opening starts
  // from a fresh state — the previous number never lingers.
  const [number, setNumber] = useState(() => (initialNumber ? formatPhone(initialNumber) : ""));
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const e164 = isValidPhone(number) ? normalizePhone(number) : null;
    if (!e164) {
      setError("Enter a phone number");
      return;
    }
    setError(null);
    try {
      await block.mutateAsync({ number: e164, comment: comment.trim() || undefined });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? "This number is already blocked" : getApiErrorMessage(err));
    }
  };

  return (
    <WzFormModal
      open={open}
      onOpenChange={onOpenChange}
      title="Block a Number"
      onSave={save}
      saveLabel="Block"
      saving={block.isPending}
      error={error}
      // Workiz's modal is 528px here, not the catalog modals' 500.
      className="w-[528px] sm:max-w-[528px]"
    >
      <input
        className={INPUT}
        name="number"
        aria-label="Number"
        autoComplete="off"
        placeholder="Block a Number"
        value={number}
        onChange={(e) => setNumber(e.target.value)}
      />
      <input
        className={INPUT}
        name="comment"
        aria-label="Comment"
        autoComplete="off"
        placeholder="I am blocking this number because..."
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
    </WzFormModal>
  );
}
