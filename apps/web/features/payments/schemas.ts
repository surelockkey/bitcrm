import { z } from "zod";
import {
  ADD_PAYMENT_TYPES,
  DEFAULT_PAYMENT_SETTINGS,
  MAX_SURCHARGE_PERCENT,
  PAYMENT_TYPE_METHOD,
  isOfflinePaymentType,
  type PaymentSettings,
} from "@bitcrm/types";
import { formatMoney } from "@/features/billing/lib";
import { isYmd } from "@/features/billing/dates";
import type { RecordPaymentBody } from "./api";
import { parseMoney } from "./lib";

const ymd = z.string().refine((v) => isYmd(v), "Pick a valid date");

/**
 * A dollar amount typed into a text box. It stays a string through validation
 * — react-hook-form's field type and the schema's stay the same shape — and
 * the submit handler turns it into cents-safe dollars with `parseMoney`.
 */
const positiveDollars = (unreadable: string) =>
  z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      const n = v === "" ? Number.NaN : Number(v);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: unreadable });
      } else if (n <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Enter an amount greater than ${formatMoney(0)}`,
        });
      }
    });

/* ------------------------------------------------------- record payment */

/**
 * Workiz's "Add payment": an amount and a Payment type. The offline types
 * (cash, Zelle, a card run elsewhere...) carry a Confirmation code, a Paid on
 * date and "Charged by referral"; Credit charge has its card form instead,
 * whose card fields live in Stripe's Elements, never here.
 */
export const recordPaymentSchema = z.object({
  amount: positiveDollars("Enter an amount"),
  type: z.enum(ADD_PAYMENT_TYPES),
  reference: z.string().trim().max(120, "At most 120 characters"),
  note: z.string().trim().max(1000, "At most 1000 characters"),
  takenAt: ymd,
  chargedByReferral: z.boolean(),
});

export type RecordPaymentValues = z.infer<typeof recordPaymentSchema>;

/** The offline form → `POST .../payments`: Workiz's type and the coarse method it maps to. */
export function toRecordPaymentBody(values: RecordPaymentValues, takenAt: string): RecordPaymentBody {
  if (!isOfflinePaymentType(values.type)) throw new Error("A credit charge is charged, not recorded");
  return {
    amount: parseMoney(values.amount),
    method: PAYMENT_TYPE_METHOD[values.type] as RecordPaymentBody["method"],
    methodDetail: values.type,
    ...(values.reference ? { reference: values.reference } : {}),
    ...(values.note ? { note: values.note } : {}),
    takenAt,
    ...(values.chargedByReferral ? { chargedByReferral: true } : {}),
  };
}

/* --------------------------------------------------------------- refund */

export const refundSchema = z.object({
  amount: positiveDollars("Enter an amount to refund"),
  reason: z.string().trim().max(500, "At most 500 characters"),
  sendReceipt: z.boolean(),
});

export type RefundValues = z.infer<typeof refundSchema>;

/* ------------------------------------------------------------- settings */

/** A non-negative dollar amount typed into a text box. */
const dollars = (message: string) =>
  z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      const n = v === "" ? Number.NaN : Number(v);
      if (!Number.isFinite(n) || n < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      }
    })
    .transform(Number);

const surcharge = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    const n = v === "" ? Number.NaN : Number(v);
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Enter a percent between 0 and ${MAX_SURCHARGE_PERCENT}`,
      });
    } else if (n > MAX_SURCHARGE_PERCENT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A card surcharge can't be more than ${MAX_SURCHARGE_PERCENT}% — the card networks cap it there.`,
      });
    }
  })
  .transform(Number);

export const paymentSettingsSchema = z
  .object({
    onlinePaymentsEnabled: z.boolean(),
    cardEnabled: z.boolean(),
    bankEnabled: z.boolean(),
    bankMinimum: dollars("Enter a minimum of $0 or more"),
    allowPartial: z.boolean(),
    surchargePercent: surcharge,
    surchargeLabel: z.string().trim().min(1, "Give the fee a name").max(60, "At most 60 characters"),
    tipsEnabled: z.boolean(),
    /** Free text: "10, 15, 20". Parsed into percentages by {@link toSettingsBody}. */
    tipPresets: z.string().trim().max(100, "At most 100 characters"),
  })
  .refine((v) => !v.onlinePaymentsEnabled || v.cardEnabled || v.bankEnabled, {
    message: "Turn on card or bank payments — online payments need at least one.",
    path: ["cardEnabled"],
  });

export type PaymentSettingsFormValues = z.input<typeof paymentSettingsSchema>;
export type PaymentSettingsFormOutput = z.output<typeof paymentSettingsSchema>;

/** Settings → the form's text boxes. Falls back to the account defaults. */
export function settingsToForm(s: PaymentSettings | undefined): PaymentSettingsFormValues {
  const v = s ?? DEFAULT_PAYMENT_SETTINGS;
  return {
    onlinePaymentsEnabled: v.onlinePaymentsEnabled,
    cardEnabled: v.cardEnabled,
    bankEnabled: v.bankEnabled,
    bankMinimum: String(v.bankMinimum ?? 0),
    allowPartial: v.allowPartial,
    surchargePercent: String(v.surchargePercent ?? 0),
    surchargeLabel: v.surchargeLabel ?? DEFAULT_PAYMENT_SETTINGS.surchargeLabel,
    tipsEnabled: v.tipsEnabled,
    tipPresets: (v.tipPresets ?? []).join(", "),
  };
}

/** "10, 15 ,, 20, x" → [10, 15, 20]. Anything unreadable is dropped. */
export function parseTipPresets(raw: string): number[] {
  return raw
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export type PaymentSettingsBody = Omit<PaymentSettings, "updatedAt" | "updatedBy">;

export function toSettingsBody(v: PaymentSettingsFormOutput): PaymentSettingsBody {
  return {
    onlinePaymentsEnabled: v.onlinePaymentsEnabled,
    cardEnabled: v.cardEnabled,
    bankEnabled: v.bankEnabled,
    bankMinimum: v.bankMinimum,
    allowPartial: v.allowPartial,
    surchargePercent: v.surchargePercent,
    surchargeLabel: v.surchargeLabel,
    tipsEnabled: v.tipsEnabled,
    tipPresets: parseTipPresets(v.tipPresets),
  };
}
