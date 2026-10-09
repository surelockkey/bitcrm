"use client";

import { useState } from "react";
import { Popover } from "radix-ui";
import { CalendarDays, CircleDollarSign, CreditCard, Eye, Loader2, Plus, Trash2, X } from "lucide-react";
import type { PaymentScheduleLine, PaymentScheduleView } from "@bitcrm/types";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WzButton } from "@/components/workiz/button";
import { WzDayPicker } from "@/components/workiz/day-picker";
import { cn } from "@/lib/utils";
import { formatYmd, todayYmd } from "@/features/billing/dates";
import { formatMoney } from "@/features/billing/lib";
import { useOpenPdf } from "@/features/billing/open-pdf";
import {
  MAX_SCHEDULED_PAYMENTS,
  MIN_SCHEDULED_PAYMENTS,
  addEntry,
  canAddEntry,
  defaultDraft,
  draftProblem,
  fromView,
  removeEntry,
  scheduleStatus,
  scheduleSummary,
  switchMethod,
  toBody,
  type ScheduleDraft,
} from "../payment-schedule";
import { getScheduledPaymentPdfUrl } from "../schedule-api";
import { useDeletePaymentSchedule, useSavePaymentSchedule } from "../schedule-hooks";
import { RecordPaymentDialog } from "./record-payment-dialog";

/*
 * Workiz's Payment schedule on the web (help centre 38044340324753; the
 * screenshots are in the parser's docs/import/mobile-payments-2026-10-02/
 * hc-38044340324753-0{1..8}-*.png): "+ Add payment schedule" under the
 * totals, the "Add / Edit payment schedule" window, and the schedule table
 * with "Remaining balance", "Delete schedule" and "Edit schedule". Sizes are
 * read off those screenshots (2× retina) against the invoice page's own
 * modules (pg_invoice_wz_*): 18px titles, 14px words, the 32px pills.
 */

/** "+ Add payment schedule" (AddOptionButton-module, pg_invoice_wz_01_partial): 219×40 #f3f6f7 r4, 13px/600 blue; #dfe2e3 hovered. */
export function AddPaymentScheduleButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-2.5 inline-flex h-10 items-center gap-2.5 rounded-[4px] bg-wz-secondary-hover px-4 text-[13px] leading-[19px] font-semibold tracking-[0.4px] text-wz-link transition-colors hover:bg-border disabled:cursor-not-allowed disabled:text-wz-outline disabled:hover:bg-wz-secondary-hover"
    >
      <Plus className="size-4" strokeWidth={1.5} aria-hidden />
      Add payment schedule
    </button>
  );
}

const TH = "h-[47px] border-b border-input px-[18px] py-[15px] text-left text-[14px] leading-4 font-bold";
const TD = "border-b border-[#dddddd] px-[18px] py-5 align-middle text-[14px] leading-4";
/** Workiz's Tag-module: white words on the colour, r4, 4px in. */
const TAG = "inline-flex items-center rounded-[4px] px-1 py-0.5 text-[13px] leading-4 text-white";
const ICON_BUTTON = "grid size-8 place-items-center rounded-[8px] text-foreground hover:bg-wz-secondary-hover disabled:cursor-not-allowed disabled:opacity-40";

/**
 * The schedule a job has (hc-38044340324753-03/-07): "Payment schedule", the
 * grey "Remaining balance" chip, "Delete schedule" in red, "Edit schedule";
 * then # · Amount (what is paid of a part-paid one) · Status · Due date · Note
 * · Actions — Add payment (what is left of that payment) and View (the invoice
 * with that payment as its balance). Workiz's per-payment Send is not here.
 */
export function PaymentScheduleTable({
  view,
  invoiceId,
  canEdit,
  canCollect,
  canViewPdf,
  onEdit,
}: {
  view: PaymentScheduleView;
  /** The job's invoice — a payment is taken against it. */
  invoiceId: string;
  /** payments.collect: Edit / Delete schedule. */
  canEdit: boolean;
  /** Taking a payment on this invoice. */
  canCollect: boolean;
  /** invoices.view: the payment's PDF. */
  canViewPdf: boolean;
  onEdit: () => void;
}) {
  const del = useDeletePaymentSchedule(view.dealId);
  const [deleting, setDeleting] = useState(false);
  const [paying, setPaying] = useState<PaymentScheduleLine | null>(null);

  return (
    <section aria-labelledby="payment-schedule-heading" className="border border-[#dddddd] text-wz-strong">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#dddddd] px-5 py-4">
        <h3 id="payment-schedule-heading" className="text-[18px] leading-[22px] font-semibold text-[#3b4c53]">
          Payment schedule
        </h3>
        <p className="inline-flex h-[30px] items-center gap-1.5 rounded-[4px] bg-wz-secondary-hover px-2.5 text-[13px] leading-4">
          <CircleDollarSign className="size-4" strokeWidth={1.25} aria-hidden />
          <span>Remaining balance:</span> <b className="font-semibold tabular-nums">{formatMoney(view.balanceDue)}</b>
        </p>
        <span className="flex-1" />
        {canEdit ? (
          <>
            <button
              type="button"
              onClick={() => setDeleting(true)}
              className="inline-flex items-center gap-1.5 text-[14px] leading-4 font-semibold text-wz-danger hover:underline"
            >
              <Trash2 className="size-4" strokeWidth={1.5} aria-hidden /> Delete schedule
            </button>
            <WzButton variant="secondary" size="regular" onClick={onEdit}>
              Edit schedule
            </WzButton>
          </>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={cn(TH, "w-[60px]")}>#</th>
              <th className={TH}>Amount</th>
              <th className={TH}>Status</th>
              <th className={TH}>Due date</th>
              <th className={TH}>Note</th>
              <th className={cn(TH, "w-[130px] text-center")}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {view.lines.map((line) => {
              const tag = scheduleStatus(line);
              return (
                <tr key={line.id}>
                  <td className={TD}>{line.index}.</td>
                  <td className={cn(TD, "tabular-nums")}>
                    {formatMoney(line.amount)}
                    {line.paid > 0 && line.remaining > 0 ? (
                      <span className="ml-1 text-[12px] text-wz-text">(paid {formatMoney(line.paid)})</span>
                    ) : null}
                  </td>
                  <td className={TD}>
                    <span className={cn(TAG, tag.className)}>{tag.label}</span>
                  </td>
                  <td className={TD}>{formatYmd(line.dueDate)}</td>
                  <td className={cn(TD, "max-w-[280px] truncate")} title={line.note}>
                    {line.note}
                  </td>
                  <td className={cn(TD, "text-center")}>
                    <span className="inline-flex items-center gap-2">
                      {canCollect ? (
                        <button
                          type="button"
                          aria-label={`Add payment for payment ${line.index}`}
                          title="Add payment"
                          disabled={line.remaining <= 0}
                          onClick={() => setPaying(line)}
                          className={ICON_BUTTON}
                        >
                          <CreditCard className="size-5" strokeWidth={1.25} />
                        </button>
                      ) : null}
                      {canViewPdf ? <ViewPaymentButton dealId={view.dealId} line={line} /> : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canCollect ? (
        <RecordPaymentDialog
          invoiceId={invoiceId}
          dealId={view.dealId}
          balanceDue={paying?.remaining ?? 0}
          open={paying !== null}
          onOpenChange={(o) => !o && setPaying(null)}
        />
      ) : null}

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the payment schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              The payments already taken stay on the job; only the split into scheduled payments goes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => del.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ViewPaymentButton({ dealId, line }: { dealId: string; line: PaymentScheduleLine }) {
  const pdf = useOpenPdf(() => getScheduledPaymentPdfUrl(dealId, line.id));
  return (
    <button
      type="button"
      aria-label={`View payment ${line.index}`}
      title="View"
      disabled={pdf.pending}
      onClick={pdf.open}
      className={ICON_BUTTON}
    >
      {pdf.pending ? <Loader2 className="size-5 animate-spin" /> : <Eye className="size-5" strokeWidth={1.25} />}
    </button>
  );
}

/* ------------------------------------------------------------- the window */

const FIELD =
  "h-12 w-full rounded-[4px] border border-wz-outline bg-white px-3 text-[16px] leading-6 text-wz-strong outline-none placeholder:text-wz-caption focus:border-wz-link";

/**
 * "Add payment schedule" / "Edit payment schedule" (hc-38044340324753-02/-08):
 * the strip (REMAINING in a grey tile, JOB TOTAL, NEXT DUE "$x | on MM/DD/YYYY",
 * N PAYMENTS over a bar), then "Payments (Add from 2 up to 12 payments)" with
 * the % / $ switch, one row per payment — the share, the due date, a note, × —
 * "+ Add payment", and Cancel / Save. Billing needs a day on every payment, so
 * each has one (Workiz lets a payment go without).
 */
export function PaymentScheduleDialog({
  open,
  onOpenChange,
  dealId,
  total,
  amountPaid,
  view,
  today = todayYmd(),
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  /** The job total the schedule splits. */
  total: number;
  /** What the job's payments have settled — the first payments count as paid. */
  amountPaid: number;
  /** The schedule the job has (Edit), or null (Add). */
  view: PaymentScheduleView | null;
  /** Today, for a new schedule's first day (tests pass it). */
  today?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[680px]">
        {/* Remounted per opening: each starts from the schedule as it stands. */}
        {open ? (
          <ScheduleEditor
            dealId={dealId}
            total={total}
            amountPaid={amountPaid}
            view={view}
            today={today}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleEditor({
  dealId,
  total,
  amountPaid,
  view,
  today,
  onDone,
}: {
  dealId: string;
  total: number;
  amountPaid: number;
  view: PaymentScheduleView | null;
  today: string;
  onDone: () => void;
}) {
  const save = useSavePaymentSchedule(dealId);
  const [draft, setDraft] = useState<ScheduleDraft>(() => (view ? fromView(view) : defaultDraft(today)));
  const problem = draftProblem(draft, total);
  const summary = scheduleSummary(draft, total, amountPaid);
  const percent = draft.method === "percent";
  const setEntry = (key: string, patch: Partial<ScheduleDraft["entries"][number]>) =>
    setDraft((d) => ({ ...d, entries: d.entries.map((e) => (e.key === key ? { ...e, ...patch } : e)) }));

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-[20px] leading-7 font-semibold">{view ? "Edit payment schedule" : "Add payment schedule"}</DialogTitle>
        <DialogDescription className="sr-only">Split the job total into payments, each with its due date.</DialogDescription>
      </DialogHeader>

      {/* The strip: REMAINING · JOB TOTAL · NEXT DUE · N PAYMENTS. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-3 text-wz-strong">
        <div className="min-w-[170px] rounded-[8px] bg-wz-secondary-hover px-4 py-3">
          <p className="text-[11px] leading-4 tracking-[0.6px] text-wz-text uppercase">Remaining</p>
          <p className="text-[24px] leading-8 font-medium tabular-nums">{formatMoney(summary.remaining)}</p>
        </div>
        <div>
          <p className="text-[11px] leading-4 tracking-[0.6px] text-wz-text uppercase">Job total</p>
          <p className="text-[16px] leading-6 font-medium tabular-nums">{formatMoney(summary.total)}</p>
        </div>
        <span aria-hidden className="h-9 w-px bg-border" />
        <div>
          <p className="text-[11px] leading-4 tracking-[0.6px] text-wz-text uppercase">Next due</p>
          <p className="text-[16px] leading-6 tabular-nums">
            {summary.next ? (
              <>
                <span className="font-medium">{formatMoney(summary.next.amount)}</span>
                <span aria-hidden className="mx-1.5 text-wz-caption">|</span>
                <span className="text-wz-text">on {formatSlashYmd(summary.next.dueDate)}</span>
              </>
            ) : (
              "—"
            )}
          </p>
        </div>
        <span aria-hidden className="h-9 w-px bg-border" />
        <div className="ml-auto min-w-[100px]">
          <p className="text-[11px] leading-4 tracking-[0.6px] text-wz-text uppercase">
            {summary.paidCount > 0 ? `${summary.paidCount}/${summary.count} payments` : `${summary.count} payments`}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e8f1fb]">
            <div
              className="h-full rounded-full bg-wz-link"
              style={{ width: `${summary.count ? Math.max(4, (summary.paidCount / summary.count) * 100) : 0}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <h4 className="text-[16px] leading-6 font-semibold text-wz-strong">
          Payments{" "}
          <span className="font-normal text-wz-text">
            (Add from {MIN_SCHEDULED_PAYMENTS} up to {MAX_SCHEDULED_PAYMENTS} payments)
          </span>
        </h4>
        <div role="radiogroup" aria-label="Calculation method" className="inline-flex rounded-[6px] bg-wz-secondary-hover p-1">
          {(["percent", "amount"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={draft.method === m}
              aria-label={m === "percent" ? "%" : "$"}
              onClick={() => setDraft((d) => switchMethod(d, m, total))}
              className={cn(
                "h-8 w-14 rounded-[4px] text-[15px] font-medium transition-colors",
                draft.method === m ? "bg-white text-wz-link shadow-[0_1px_3px_rgba(59,75,82,0.2)]" : "text-wz-strong hover:bg-white/60",
              )}
            >
              {m === "percent" ? "%" : "$"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[24px_120px_minmax(0,1fr)_minmax(0,1.4fr)_32px] items-center gap-x-3 gap-y-3 text-wz-strong">
        <span />
        <span className="text-[14px] font-medium">Payment</span>
        <span className="text-[14px] font-medium">Due date</span>
        <span className="text-[14px] font-medium">Note</span>
        <span />
        {draft.entries.map((e, i) => (
          <Row
            key={e.key}
            n={i + 1}
            percent={percent}
            value={percent ? e.percent : e.amount}
            dueDate={e.dueDate}
            note={e.note}
            canRemove={draft.entries.length > MIN_SCHEDULED_PAYMENTS}
            onValue={(v) => setEntry(e.key, percent ? { percent: v } : { amount: v })}
            onDueDate={(dueDate) => setEntry(e.key, { dueDate })}
            onNote={(note) => setEntry(e.key, { note })}
            onRemove={() => setDraft((d) => removeEntry(d, e.key))}
          />
        ))}
      </div>

      <div className="mt-4">
        <WzButton
          variant="secondary"
          size="regular"
          icon={<Plus strokeWidth={1.5} />}
          disabled={!canAddEntry(draft)}
          onClick={() => setDraft((d) => addEntry(d, total))}
          className="disabled:border-wz-outline disabled:text-wz-outline"
        >
          Add payment
        </WzButton>
      </div>

      {problem ? (
        <p role="alert" className="mt-3 text-[13px] leading-4 text-wz-error">
          {problem}
        </p>
      ) : null}

      <div className="mt-6 flex items-center justify-end gap-6">
        <button type="button" onClick={onDone} className="text-[15px] font-semibold text-wz-strong hover:underline">
          Cancel
        </button>
        <WzButton
          size="big"
          className="min-w-[110px] text-[15px]"
          disabled={!!problem}
          loading={save.isPending}
          onClick={() => save.mutate(toBody(draft), { onSuccess: onDone })}
        >
          Save
        </WzButton>
      </div>
    </>
  );
}

/** "10/06/2026" — the strip's day. */
function formatSlashYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${m}/${d}/${y}` : "";
}

function Row({
  n,
  percent,
  value,
  dueDate,
  note,
  canRemove,
  onValue,
  onDueDate,
  onNote,
  onRemove,
}: {
  n: number;
  percent: boolean;
  value: string;
  dueDate: string;
  note: string;
  canRemove: boolean;
  onValue: (v: string) => void;
  onDueDate: (ymd: string) => void;
  onNote: (v: string) => void;
  onRemove: () => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <>
      <span className="text-[15px] font-medium">{n}.</span>
      <label className="relative">
        {percent ? null : <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-wz-text">$</span>}
        <input
          aria-label={`Payment ${n}`}
          inputMode="decimal"
          value={value}
          onChange={(e) => onValue(e.target.value)}
          className={cn(FIELD, percent ? "pr-8" : "pl-6", "tabular-nums")}
        />
        {percent ? <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-wz-text">%</span> : null}
      </label>
      <Popover.Root open={picking} onOpenChange={setPicking}>
        <Popover.Trigger asChild>
          <button type="button" aria-label={`Due date ${n}`} className={cn(FIELD, "flex items-center gap-2.5 text-left")}>
            <CalendarDays className="size-5 shrink-0 text-wz-text" strokeWidth={1.25} aria-hidden />
            {dueDate ? formatYmd(dueDate) : <span className="text-wz-caption">Select due date</span>}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={6} className="z-[60] outline-none">
            <WzDayPicker
              value={dueDate || todayYmd()}
              today={todayYmd()}
              onSelect={(day) => {
                setPicking(false);
                onDueDate(day);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <input
        aria-label={`Note ${n}`}
        placeholder="Add note"
        maxLength={500}
        value={note}
        onChange={(e) => onNote(e.target.value)}
        className={FIELD}
      />
      <button
        type="button"
        aria-label={`Remove payment ${n}`}
        disabled={!canRemove}
        onClick={onRemove}
        className="grid size-8 place-items-center rounded-full bg-wz-secondary-hover text-wz-strong hover:bg-border disabled:cursor-not-allowed disabled:opacity-40"
      >
        <X className="size-4" strokeWidth={1.5} />
      </button>
    </>
  );
}
