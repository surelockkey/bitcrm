import { z } from "zod";
import { ClientType, ContactSource, ContactType } from "@bitcrm/types";

const phoneRow = z.string().trim().min(1, "Enter a phone or remove the row");
const emailRow = z.string().trim().email("Enter a valid email");

/** Contact create/edit form. A contact needs ≥1 phone, a type, and a source. */
export const contactFormSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  phones: z.array(phoneRow).min(1, "Add at least one phone"),
  emails: z.array(emailRow),
  companyId: z.string().optional(),
  type: z.nativeEnum(ContactType),
  source: z.nativeEnum(ContactSource),
  title: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});
export type ContactFormValues = z.infer<typeof contactFormSchema>;

/** Company form. Phones/emails are optional; a company needs a name + type. */
export const companyFormSchema = z.object({
  title: z.string().trim().min(1, "Company name is required"),
  phones: z.array(phoneRow),
  emails: z.array(emailRow),
  address: z.string().trim().optional(),
  website: z.string().trim().optional(),
  clientType: z.nativeEnum(ClientType),
  notes: z.string().trim().optional(),
});
export type CompanyFormValues = z.infer<typeof companyFormSchema>;

/* API payload shapes. `source` is immutable, so it's absent from updates. */
export type CreateContactValues = ContactFormValues;
export type UpdateContactValues = Omit<ContactFormValues, "source">;
export type CreateCompanyValues = CompanyFormValues;
export type UpdateCompanyValues = CompanyFormValues;
