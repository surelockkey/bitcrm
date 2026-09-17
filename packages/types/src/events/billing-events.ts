export const BILLING_EVENT_TOPIC = 'billing-events';

export enum BillingEventType {
  INVOICE_CREATED = 'invoice.created',
  INVOICE_UPDATED = 'invoice.updated',
  INVOICE_DELETED = 'invoice.deleted',
  ESTIMATE_CREATED = 'estimate.created',
  ESTIMATE_UPDATED = 'estimate.updated',
  ESTIMATE_DELETED = 'estimate.deleted',
  ESTIMATE_SYNCED = 'estimate.synced',
}

export interface InvoiceEvent {
  invoiceId: string;
  dealId: string;
  contactId: string;
  number: string;
  status: string;
  total: number;
}

export interface EstimateEvent {
  estimateId: string;
  dealId: string;
  contactId: string;
  number: string;
  status: string;
  total: number;
}
