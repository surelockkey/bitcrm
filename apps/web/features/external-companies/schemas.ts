import { z } from "zod";

export const externalCompanyFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  // Optional contact details — most of the list has blanks, so an empty string
  // is valid and is sent as-is so the backend can clear a field.
  email: z
    .string()
    .trim()
    .default("")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email"),
  address: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  active: z.boolean().default(true),
});

export type ExternalCompanyFormValues = z.input<typeof externalCompanyFormSchema>;
export type ExternalCompanyFormOutput = z.output<typeof externalCompanyFormSchema>;

/** Map validated form values to the create/update request body. */
export function toExternalCompanyBody(values: ExternalCompanyFormOutput) {
  return {
    name: values.name,
    email: values.email,
    address: values.address,
    phone: values.phone,
    active: values.active,
  };
}
