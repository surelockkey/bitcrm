export const BILLING_EVENT_TOPIC = 'billing-events';

export enum BillingEventType {
  INVOICE_CREATED = 'invoice.created',
  INVOICE_UPDATED = 'invoice.updated',
  INVOICE_DELETED = 'invoice.deleted',
  ESTIMATE_CREATED = 'estimate.created',
  ESTIMATE_UPDATED = 'estimate.updated',
  ESTIMATE_DELETED = 'estimate.deleted',
  ESTIMATE_SYNCED = 'estimate.synced',
  PAYMENT_SUCCEEDED = 'payment.succeeded',
  PAYMENT_PENDING = 'payment.pending',
  PAYMENT_FAILED = 'payment.failed',
  PAYMENT_REFUNDED = 'payment.refunded',
  PAYMENT_REVERSED = 'payment.reversed',
}

export interface InvoiceEvent {
  invoiceId: string;
  /** Absent for a client invoice (no job). */
  dealId?: string;
  contactId: string;
  number: string;
  status: string;
  total: number;
}

export interface PaymentEvent {
  paymentId: string;
  invoiceId: string;
  dealId: string;
  contactId: string;
  amount: number;
  method: string;
  status: string;
  /** The invoice's remaining balance after this event. */
  balanceDue: number;
}

export interface EstimateEvent {
  estimateId: string;
  /** Absent for a client estimate (no job). */
  dealId?: string;
  contactId: string;
  number: string;
  status: string;
  total: number;
}
