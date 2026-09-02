import { ContactType } from '../enums/contact-type.enum';
import { ContactSource } from '../enums/contact-source.enum';
import { CrmStatus } from '../enums/crm-status.enum';
import { Address } from './address.entity';

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
  emails: string[];
  /** Structured postal addresses (Google-autocompleted); a client may have several. */
  addresses: Address[];
  companyId?: string;
  type: ContactType;
  title?: string;
  source: ContactSource;
  notes?: string;
  status: CrmStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
