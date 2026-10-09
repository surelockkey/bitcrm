"use client";

import { useId, type ReactNode } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { WzButton } from "./button";
import { WzDrawer } from "./drawer";

/*
 * Workiz's settings forms — the "Add New Job Type" / "Edit Job Type" modal
 * (pg_settings_catalogs_wz_jobtypes_add_open / _row_open), "Add Sub status"
 * (_substatus_add_open), "Add New Service area" (_metroareas_add_open, the
 * whole window) and "Add New Field" (_customfields_add_open, a right-hand
 * drawer):
 *
 *   modal   500px, white, 16px corners, 24px in, the shared Dialog shadow
 *           over black 30%; h4 18px/27px 600 ink; fields 24px under it and
 *           24px apart; Cancel (secondary) and Save (primary), Workiz's big
 *           40px pills, 16px apart at the bottom right, 24px from the edge.
 *   full    the same over the whole window, Cancel / Save on a white footer
 *           under a 1px rule (#eeeeee), 80px from the right.
 *   drawer  WzDrawer's band head (the title centred), 350px, Cancel / Save
 *           sharing the footer half and half.
 *
 * The fields sit in a <form>: Enter in a field saves, as Workiz's does.
 */
export function WzFormModal({
  open,
  onOpenChange,
  title,
  description,
  onSave,
  saveLabel = "Save",
  saving = false,
  saveDisabled = false,
  error,
  variant = "modal",
  readOnly = false,
  aside,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** 14px/21px ink under the title (Sub Status's "Create a sub-status under…"). */
  description?: ReactNode;
  onSave: () => void;
  saveLabel?: string;
  saving?: boolean;
  saveDisabled?: boolean;
  /** A refusal over the buttons (#e35a36). */
  error?: string | null;
  variant?: "modal" | "full" | "drawer";
  /** The reader may look, not change: no Save, Cancel reads "Close", Enter saves nothing. */
  readOnly?: boolean;
  /**
   * Beside the fields, 48px to their right (`full` only): the Account page's
   * column with the logo (pg_settings_general_wz_account).
   */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const formId = useId();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!readOnly && !saveDisabled && !saving) onSave();
  };

  const cancel = (
    <WzButton variant="secondary" size="big" onClick={() => onOpenChange(false)} className={variant === "drawer" ? "flex-1" : undefined}>
      {readOnly ? "Close" : "Cancel"}
    </WzButton>
  );
  const save = readOnly ? null : (
    <WzButton
      type="submit"
      form={formId}
      variant="primary"
      size="big"
      loading={saving}
      disabled={saveDisabled}
      // Workiz's held Save: #eff1f1 with #9ea6aa words (substatus_add_open).
      className={cn(
        "disabled:bg-wz-disabled-fill disabled:hover:bg-wz-disabled-fill [&:disabled>span]:text-wz-outline",
        variant === "drawer" && "flex-1",
      )}
    >
      {saveLabel}
    </WzButton>
  );
  const refusal = error ? (
    <p role="alert" className="text-sm leading-[21px] text-wz-error">
      {error}
    </p>
  ) : null;

  if (variant === "drawer") {
    return (
      <WzDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        head="band"
        width={350}
        className={className}
        bodyClassName="px-5 pt-7"
        footer={
          <div className="flex w-full gap-4 border-t border-[#eeeeee] pt-3">
            {cancel}
            {save}
          </div>
        }
      >
        <form id={formId} onSubmit={submit} className="flex flex-col gap-6">
          {description ? <p className="text-sm leading-[21px] text-foreground">{description}</p> : null}
          {children}
          {refusal}
        </form>
      </WzDrawer>
    );
  }

  const full = variant === "full";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        data-variant={variant}
        // Workiz opens its form with nothing focused (every label resting in
        // its box); the modal itself takes the focus, so Tab starts inside.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
        className={cn(
          "flex flex-col gap-0",
          full
            ? "top-0 left-0 h-full w-full max-w-none translate-x-0 translate-y-0 p-0 sm:max-w-none"
            : "w-[500px] sm:max-w-[500px]",
          className,
        )}
      >
        <div className={cn("flex min-h-0 flex-1 flex-col", full && "overflow-y-auto px-[24px] pt-[24px]")}>
          <DialogTitle className="pr-10">{title}</DialogTitle>
          {description ? <p className="mt-2 text-sm leading-[21px] text-foreground">{description}</p> : null}
          {full && aside ? (
            <div className="mt-6 flex items-start gap-12">
              <form id={formId} onSubmit={submit} className="flex min-w-0 flex-col gap-6">
                {children}
                {refusal}
              </form>
              <div className="shrink-0">{aside}</div>
            </div>
          ) : (
            <form id={formId} onSubmit={submit} className={cn("mt-6 flex flex-col gap-6", full && "max-w-[755px] pl-1.5")}>
              {children}
              {refusal}
            </form>
          )}
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center justify-end gap-4",
            full ? "border-t border-[#eeeeee] py-[19px] pr-20" : "pt-10",
          )}
        >
          {cancel}
          {save}
        </div>
      </DialogContent>
    </Dialog>
  );
}
