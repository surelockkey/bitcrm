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
  /**
   * The message that goes with the portal link (Workiz: Settings → Documents →
   * Email options; the proposal's "Edit template" in the Send pane). Email
   * uses subject + message, a text uses the message alone. Short codes:
   * `{{client.firstName}}`, `{{client.fullName}}`, `{{business.name}}`,
   * `{{document.number}}`, `{{document.total}}`, `{{portal_link}}` — the
   * link is mandatory, the client has nothing to open without it.
   */
  invoiceEmailSubject: string;
  invoiceMessage: string;
  estimateEmailSubject: string;
  estimateMessage: string;
  proposalEmailSubject: string;
  proposalMessage: string;
  updatedBy?: string;
  updatedAt?: string;
}

/** Workiz's own default, present on 8 585 of the 8 635 imported estimates. */
export const DEFAULT_DOCUMENT_NOTES = 'Thank you for considering our services!';

export const DOCUMENT_NOTES_MAX_LENGTH = 5000;

/** The short code every send message must keep. */
export const PORTAL_LINK_SHORT_CODE = '{{portal_link}}';

export const DOCUMENT_MESSAGE_SHORT_CODES = [
  'client.firstName',
  'client.fullName',
  'business.name',
  'document.number',
  'document.total',
  'portal_link',
] as const;

export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettings = {
  estimateNotes: DEFAULT_DOCUMENT_NOTES,
  invoiceNotes: DEFAULT_DOCUMENT_NOTES,
  requestInvoiceSignature: true,
  showUnselectedProposalOptions: false,
  invoiceEmailSubject: 'Your invoice from {{business.name}}',
  invoiceMessage:
    'Hi {{client.firstName}},\n\nThanks again for choosing {{business.name}}! Your invoice #{{document.number}} ' +
    '({{document.total}}) is ready. View and pay it here: {{portal_link}}',
  estimateEmailSubject: 'Your estimate from {{business.name}}',
  estimateMessage:
    'Hi {{client.firstName}},\n\nThanks for taking the time to chat with us at {{business.name}}. Your estimate ' +
    '#{{document.number}} is now available. View and approve it here: {{portal_link}}',
  proposalEmailSubject: 'View your proposal from {{business.name}}',
  proposalMessage:
    'Hi {{client.firstName}},\n\nThanks for taking the time to chat with us at {{business.name}}! Please click below ' +
    'to view the different options we put together for you. Feel free to reach out if you have any questions.\n\n{{portal_link}}',
};
