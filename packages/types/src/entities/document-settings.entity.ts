/**
 * Account-wide defaults for estimates and invoices (Workiz: Settings →
 * Documents, plus the estimate's "Set for future estimates" deposit box and
 * the "Request signature" box of the Send panel). A singleton in the billing
 * table; reads fall back to `DEFAULT_DOCUMENT_SETTINGS` until one is saved.
 */
export interface DocumentSettings {
  /** Pre-filled Notes on a NEW estimate. */
  estimateNotes: string;
  /** Pre-filled Notes on a NEW invoice. */
  invoiceNotes: string;
  /**
   * Default deposit for new estimates: a percent of the total OR a fixed
   * dollar amount (never both). Neither ⇒ new estimates ask for no deposit.
   */
  depositPercentage?: number;
  depositAmount?: number;
  /** "Request signature" starts checked when sending an invoice. Estimates always need one. */
  requestInvoiceSignature: boolean;
  /** After the client approves one option of a proposal, keep the other options visible. */
  showUnselectedProposalOptions: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

/** Workiz's own default, present on 8 585 of the 8 635 imported estimates. */
export const DEFAULT_DOCUMENT_NOTES = 'Thank you for considering our services!';

export const DOCUMENT_NOTES_MAX_LENGTH = 5000;

export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettings = {
  estimateNotes: DEFAULT_DOCUMENT_NOTES,
  invoiceNotes: DEFAULT_DOCUMENT_NOTES,
  requestInvoiceSignature: true,
  showUnselectedProposalOptions: false,
};
