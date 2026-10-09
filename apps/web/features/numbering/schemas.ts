import { z } from "zod";
import { DOCUMENT_NUMBER_MAX, type NumberingSettings } from "@bitcrm/types";
import type { NumberingBody } from "./api";

/** A box's text: digits only, a whole number from 1 up to nine digits. */
const wholeNumber = z
  .string()
  .trim()
  .regex(/^\d+$/, "Enter a whole number")
  .refine((s) => Number(s) >= 1 && Number(s) <= DOCUMENT_NUMBER_MAX, `Enter a whole number from 1 to ${DOCUMENT_NUMBER_MAX}`);

export const numberingFormSchema = z.object({
  nextInvoiceNumber: wholeNumber,
  nextEstimateNumber: wholeNumber,
});

export type NumberingFormValues = z.input<typeof numberingFormSchema>;
export type NumberingField = keyof NumberingFormValues;

/** The settings as the boxes show them. */
export function numberingToForm(s: NumberingSettings | undefined): NumberingFormValues {
  return {
    nextInvoiceNumber: s ? String(s.nextInvoiceNumber) : "",
    nextEstimateNumber: s ? String(s.nextEstimateNumber) : "",
  };
}

/** The boxes' text as the server takes it. */
export function toNumberingBody(v: NumberingFormValues): NumberingBody {
  return { nextInvoiceNumber: Number(v.nextInvoiceNumber), nextEstimateNumber: Number(v.nextEstimateNumber) };
}

/** Which box a server refusal is about — it opens with the box's own name ("Next Invoice Id must be more than…"). */
export function fieldOfRefusal(message: string): NumberingField | null {
  if (message.startsWith("Next Invoice Id")) return "nextInvoiceNumber";
  if (message.startsWith("Next Estimate Id")) return "nextEstimateNumber";
  return null;
}
