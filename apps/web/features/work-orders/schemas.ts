import { z } from "zod";

export const workOrderFormSchema = z.object({
  woNumber: z.string().trim().min(1, "WO number is required"),
  companyId: z.string().min(1, "Pick a company"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  amount: z.number().min(0).optional(),
  description: z.string().trim().optional(),
});
export type WorkOrderFormValues = z.infer<typeof workOrderFormSchema>;
