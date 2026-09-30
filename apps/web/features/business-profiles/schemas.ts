import { z } from "zod";
import { PaymentTerms, type Address, type BusinessProfile } from "@bitcrm/types";

export const DUE_DATE_BASES = ["invoice_created", "job_created", "job_scheduled"] as const;
export type DueDateBasis = (typeof DUE_DATE_BASES)[number];

export const DUE_DATE_BASIS_LABELS: Record<DueDateBasis, string> = {
  invoice_created: "Invoice created",
  job_created: "Job created",
  job_scheduled: "Job scheduled",
};

export const PAYMENT_TERMS_OPTIONS: { value: PaymentTerms; label: string }[] = [
  { value: PaymentTerms.CASH, label: "Due upon receipt" },
  { value: PaymentTerms.NET_15, label: "Net 15" },
  { value: PaymentTerms.NET_30, label: "Net 30" },
  { value: PaymentTerms.NET_60, label: "Net 60" },
  { value: PaymentTerms.CUSTOM, label: "Custom" },
];

const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters`);

const addressSchema = z
  .object({
    street: text(200),
    unit: text(50),
    city: text(100),
    state: text(50),
    zip: text(20),
    lat: z.number().optional(),
    lng: z.number().optional(),
  })
  .superRefine((a, ctx) => {
    const any = [a.street, a.unit, a.city, a.state, a.zip].some(Boolean);
    if (!any) return;
    for (const key of ["street", "city", "state", "zip"] as const) {
      if (!a[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Required" });
    }
  });

/** One company (business profile) — every field the documents print. */
export const companyFormSchema = z
  .object({
    name: text(200).min(1, "Company name is required"),
    legalName: text(200),
    phone: text(40),
    email: text(200).refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email"),
    website: text(200),
    licenseNumber: text(100),
    address: addressSchema,
    /** "" = no logo. */
    logoAssetId: z.string(),
    active: z.boolean(),
    defaultPaymentTerms: z.nativeEnum(PaymentTerms),
    defaultCustomTermDays: z.string().trim(),
    dueDateBasis: z.enum(DUE_DATE_BASES),
  })
  .superRefine((v, ctx) => {
    if (v.defaultPaymentTerms !== PaymentTerms.CUSTOM) return;
    const days = Number(v.defaultCustomTermDays);
    if (!v.defaultCustomTermDays || !Number.isInteger(days) || days < 1 || days > 365) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultCustomTermDays"], message: "Enter 1–365 days" });
    }
  });

export type CompanyFormValues = z.infer<typeof companyFormSchema>;

export function companyToForm(p: BusinessProfile | undefined): CompanyFormValues {
  return {
    name: p?.name ?? "",
    legalName: p?.legalName ?? "",
    phone: p?.phone ?? "",
    email: p?.email ?? "",
    website: p?.website ?? "",
    licenseNumber: p?.licenseNumber ?? "",
    address: {
      street: p?.address?.street ?? "",
      unit: p?.address?.unit ?? "",
      city: p?.address?.city ?? "",
      state: p?.address?.state ?? "",
      zip: p?.address?.zip ?? "",
      lat: p?.address?.lat,
      lng: p?.address?.lng,
    },
    logoAssetId: p?.logoAssetId ?? "",
    active: p?.active ?? true,
    defaultPaymentTerms: p?.defaultPaymentTerms ?? PaymentTerms.CASH,
    defaultCustomTermDays: p?.defaultCustomTermDays !== undefined ? String(p.defaultCustomTermDays) : "",
    dueDateBasis: p?.dueDateBasis ?? "invoice_created",
  };
}

const OPTIONAL_TEXT = ["legalName", "phone", "email", "website", "licenseNumber", "logoAssetId"] as const;
type OptionalText = (typeof OPTIONAL_TEXT)[number];

/**
 * Create/update body. Update sends `null` for every cleared optional field —
 * the API treats `null` as "remove", so a removed logo is `logoAssetId: null`.
 */
export type CompanyWriteBody = {
  name: string;
  active: boolean;
  defaultPaymentTerms: PaymentTerms;
  dueDateBasis: DueDateBasis;
  defaultCustomTermDays?: number | null;
  address?: Address | null;
} & { [K in OptionalText]?: string | null };

export function formToCompanyBody(v: CompanyFormValues, mode: "create" | "update"): CompanyWriteBody {
  const clear = mode === "update";
  const out: CompanyWriteBody = {
    name: v.name,
    active: v.active,
    defaultPaymentTerms: v.defaultPaymentTerms,
    dueDateBasis: v.dueDateBasis,
  };
  for (const key of OPTIONAL_TEXT) {
    if (v[key]) out[key] = v[key];
    else if (clear) out[key] = null;
  }
  const a = v.address;
  if (a.street) {
    const address: Address = { street: a.street, city: a.city, state: a.state, zip: a.zip };
    if (a.unit) address.unit = a.unit;
    if (a.lat !== undefined) address.lat = a.lat;
    if (a.lng !== undefined) address.lng = a.lng;
    out.address = address;
  } else if (clear) {
    out.address = null;
  }
  if (v.defaultPaymentTerms === PaymentTerms.CUSTOM) out.defaultCustomTermDays = Number(v.defaultCustomTermDays);
  else if (clear) out.defaultCustomTermDays = null;
  return out;
}
