import { ContactType } from '../enums/contact-type.enum';
import { ContactSource } from '../enums/contact-source.enum';
import { CrmStatus } from '../enums/crm-status.enum';
import { Address } from './address.entity';
import { PaymentTerms } from '../enums/payment-terms.enum';
import { CustomFieldValue } from './custom-field.entity';

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  phones: string[];
  /**
   * Set only when the viewer lacks `contacts.view_numbers`: `phones` comes back
   * empty and this says how many were withheld, so the UI can render
   * "2 numbers, hidden" rather than the "—" that means genuinely none.
   */
  phoneCount?: number;
  phonesMasked?: true;
  /**
   * What to press once the call is answered — `{ '+14045551234': '102' }`.
   * Keyed by the number it belongs to rather than sitting in the number
   * itself, so the phone stays dialable and the call log keeps matching it.
   */
  phoneExtensions?: Record<string, string>;
  /**
   * A masked viewer's extensions (`phonesMasked`): `phoneExtensions` is keyed
   * by the number, so it is withheld with them, and this carries the same
   * extensions by position — `[i]` belongs to hidden number `i`, '' for none.
   * Absent when no number has one.
   */
  phoneExtensionsByIndex?: string[];
  emails: string[];
  /**
   * Structured postal addresses (Google-autocompleted); a client may have
   * several. The first one is the service address the client card shows.
   */
  addresses: Address[];
  /** Where invoices go, when that isn't the service address (Workiz's billing address). */
  billingAddress?: Address;
  /** The date of the client's latest job, "YYYY-MM-DD" — kept by the Workiz import. */
  lastJobAt?: string;
  /** Client tags (the ClientTag catalog), as Workiz's chips on the client card. */
  tagIds?: string[];
  /**
   * Answers to the client custom fields (definitions with
   * `entityType: 'client'`), keyed by definition id — the client card's
   * "Custom fields" tab. Blank answers are not stored.
   */
  customFields?: Record<string, CustomFieldValue>;
  /**
   * Workiz's "Ad source" on the client: a JobSource catalog id (the same
   * catalog jobs use). `source` is the closed enum the form always had.
   */
  sourceId?: string;
  /**
   * Workiz's "Client payment terms": client terms win over the company's and
   * the business profile's when an invoice is made (billing's
   * `resolvePaymentTerms`). `customTermsDays` holds the days for `custom`.
   */
  paymentTerms?: PaymentTerms;
  customTermsDays?: number;
  companyId?: string;
  type: ContactType;
  title?: string;
  source: ContactSource;
  notes?: string;
  /** Tax-exempt client: new jobs/estimates carry no tax. */
  taxExempt?: boolean;
  taxExemptReason?: string;
  status: CrmStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
