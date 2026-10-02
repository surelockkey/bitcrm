/**
 * The payment ledger. An invoice's `amountPaid` is the sum of its SETTLED
 * payments — not a flag — so partial payments, several attempts, and money
 * that comes back later all work without a schema change.
 *
 * Why `reversed` exists: an ACH debit can fail days AFTER Stripe reports the
 * PaymentIntent as `succeeded`. Stripe reports that as a dispute, not a
 * failure, and the intent stays `succeeded` forever. So a payment must be able
 * to stop counting, which pushes its invoice back to `due`/`overdue` on its own.
 */

/** How the money arrived. `bank` is ACH; `card` covers wallets and card-present. */
export const PAYMENT_METHODS = ['card', 'bank', 'cash', 'check', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods a client can choose in the portal (the rest are recorded by staff). */
export const ONLINE_PAYMENT_METHODS = ['card', 'bank'] as const;
export type OnlinePaymentMethod = (typeof ONLINE_PAYMENT_METHODS)[number];

/**
 * - `pending`  — taken, money not landed yet (ACH in transit). Shown, not counted.
 * - `settled`  — collected. The only status that reduces the balance.
 * - `failed`   — never collected.
 * - `reversed` — was settled, then pulled back (ACH return, dispute lost).
 * - `refunded` — fully refunded. A PARTIAL refund leaves the payment `settled`
 *                with `refundedAmount > 0`; only `refundedAmount === amount`
 *                becomes `refunded`.
 */
export const PAYMENT_STATUSES = ['pending', 'settled', 'failed', 'reversed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Statuses that count toward what the customer has paid. */
export const COUNTED_PAYMENT_STATUSES: readonly PaymentStatus[] = ['settled', 'refunded'];

/** Where the payment was taken. */
export const PAYMENT_SOURCES = ['portal', 'office', 'field', 'system'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

/**
 * How a card reached Stripe, when it was not the client's own portal
 * checkout. Both are taken on a staff phone, and both write the ledger row
 * first, `pending`:
 *  - `terminal` — card-present through Stripe Terminal (Tap to Pay): then a
 *    `card_present` PaymentIntent the device collects and confirms.
 *  - `keyed` — the card typed in by the technician while the client is there
 *    (Workiz "Credit card payment"): the phone turns it into a PaymentMethod
 *    and billing creates AND confirms a `card` PaymentIntent with it.
 */
export const PAYMENT_CHANNELS = ['terminal', 'keyed'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export interface Payment {
  id: string;
  /** === invoiceId === dealId. One invoice per job, so these are the same value. */
  invoiceId: string;
  dealId: string;
  /**
   * Set when the payment is an estimate's DEPOSIT (Workiz
   * `clientPortalEstimateDeposit`). The row still sits on the job's ledger —
   * a deposit is applied to the job's balance, and so to its invoice.
   */
  estimateId?: string;
  contactId: string;
  companyId?: string;
  /** Dollars, 2dp — the gross amount taken, before any refund. */
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  /**
   * Given back so far, dollars. Never exceeds what was charged: `amount`, plus
   * `tipAmount` and `feeAmount` on a payment taken through Stripe (they went
   * through the same charge, so they can be refunded too).
   */
  refundedAmount: number;
  /**
   * Charged on top of `amount`, never toward the balance (off by default —
   * `PaymentSettings.surchargePercent`): the portal's card surcharge, or the
   * "Service fee" on a card taken on a staff phone (`surchargePercent` of
   * `amount + tipAmount`).
   */
  feeAmount?: number;
  /** Tip on top of `amount`, dollars. Never counts toward the balance. */
  tipAmount?: number;
  source: PaymentSource;
  /** `terminal` for a card tapped on a staff phone (Stripe Terminal), `keyed` for one typed in on it. Absent otherwise. */
  channel?: PaymentChannel;
  /** Cheque number, confirmation code, "paid to tech Mike" — staff's own note. */
  reference?: string;
  note?: string;
  /** Stripe joins. Absent on offline payments. Each is also a pointer row. */
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  stripeSessionId?: string;
  /** For display on the payment row. Never a full card number. */
  cardBrand?: string;
  last4?: string;
  /** Plain-language reason a dispatcher can act on. */
  failureReason?: string;
  /** User id, or `client` when the customer paid it themselves in the portal. */
  takenBy: string;
  takenAt: string;
  settledAt?: string;
  reversedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;

  // ---- Workiz parity (all optional; the Payments report reads them) --------
  /**
   * The Workiz payment type (`charge`, `credit`, `check`, `cash`, `zelle`,
   * `installments`, …) — finer than `method`, which has five values. Set by
   * the Workiz import; a payment taken here derives it from `method` (see
   * `paymentReportType`). Keys of `PAYMENT_REPORT_TYPE_LABELS`.
   */
  methodDetail?: string;
  /** Workiz's own label for `methodDetail`, as imported ("Credit offline"). */
  methodLabel?: string;
  /** How a card payment was collected: "Client portal", "Card reader", "Keyed". */
  transactionMethod?: string;
  /** What the processor kept (Workiz Pay `app_fee`), dollars. NOT `feeAmount`, which is our surcharge. */
  processingFee?: number;
  /** `amount + tipAmount − processingFee` as the processor paid it out, dollars. */
  netAmount?: number;
  /** The job's lead technician when the payment was taken (Workiz "Technician"). */
  technicianId?: string;
  /** The job's service area when the payment was taken (the report's Service Areas filter). */
  serviceAreaId?: string;
  /** Who took the payment in Workiz ("Collected by") — imported rows; ours use `takenBy`. */
  collectedBy?: string;
  collectedByName?: string;
  /** Workiz's `amount`, which INCLUDES the tip (ours is `amount + tipAmount`). Imported rows only. */
  workizAmount?: number;
  externalId?: string;
  workizId?: number;
}

/** One refund against one payment. Stripe allows several partial refunds. */
export const REFUND_STATUSES = ['pending', 'succeeded', 'failed', 'canceled'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export interface PaymentRefund {
  id: string;
  paymentId: string;
  invoiceId: string;
  amount: number;
  /** Shown to the customer on the refund receipt when set. */
  reason?: string;
  status: RefundStatus;
  stripeRefundId?: string;
  failureReason?: string;
  refundedBy: string;
  createdAt: string;
  updatedAt: string;

  // ---- Workiz parity (all optional; imported refunds carry them) -----------
  /** The job, denormalised (=== the payment's `dealId`). */
  dealId?: string;
  /**
   * The Workiz type of the refund line: `refund` / `refund_offline`, or — for
   * a negative offline payment Workiz allocated to this one — its own type
   * (`credit`, `cash`, `check`…). The Payments report files the line under it.
   */
  methodDetail?: string;
  methodLabel?: string;
  /** Workiz's signed amount of the refund line (negative). Imported rows only. */
  workizAmount?: number;
  /** Confirmation code / cheque number of the refund, when Workiz had one. */
  reference?: string;
  note?: string;
  transactionMethod?: string;
  collectedByName?: string;
  externalId?: string;
  workizId?: number;
}

/** What an invoice's ledger adds up to. Computed, never stored on its own. */
export interface PaymentSummary {
  /** Counts toward the balance (settled + fully-refunded gross, less refunds). */
  settled: number;
  /** Taken but not landed — ACH in transit. Shown separately, never counted. */
  pending: number;
  refunded: number;
  paymentCount: number;
  lastPaymentAt?: string;
  /** True while any ACH payment is in flight — the UI says "clearing". */
  hasPending: boolean;
}

/**
 * A JOB's payment ledger — Workiz's Payments tab on the job. In Workiz a
 * payment belongs to the job and an invoice is a separate document made only
 * by "Create invoice", so this works whether or not the job has an invoice:
 * the ledger lives under the job's id either way (invoice id === deal id).
 */
export interface JobPaymentLedger {
  dealId: string;
  /** Set only when the job HAS an invoice (and then it equals `dealId`). */
  invoiceId?: string;
  /** Newest first. */
  payments: Payment[];
  summary: PaymentSummary;
  /** The invoice total when there is an invoice, otherwise the job's own total. */
  total: number;
  /** === `summary.settled` — what counts toward the balance. */
  amountPaid: number;
  /** `total - amountPaid`, never below zero. */
  balanceDue: number;
}

export const EMPTY_PAYMENT_SUMMARY: PaymentSummary = {
  settled: 0,
  pending: 0,
  refunded: 0,
  paymentCount: 0,
  hasPending: false,
};

/**
 * Account-level payment configuration (one Stripe account per workspace).
 * Stored as a singleton in the billing table.
 */
export interface PaymentSettings {
  /** Master switch. Stays false until Stripe keys are present and verified. */
  onlinePaymentsEnabled: boolean;
  cardEnabled: boolean;
  /** ACH. Cheaper (capped at $5) but can reverse days later. */
  bankEnabled: boolean;
  /** Stripe/Workiz both floor bank payments; dollars. */
  bankMinimum: number;
  /** Let the client pay less than the full balance (Workiz: an editable amount). */
  allowPartial: boolean;
  /**
   * Card surcharge. OFF by default and deliberately so: US card-network rules
   * cap it at the lower of your processing rate or 3% (credit only), it is
   * banned outright in CT / MA / ME / PR, capped at 2% in CO, and New York
   * forbids revealing it after the customer picks a card. Steering to bank
   * payment achieves the same saving with none of that.
   */
  surchargePercent: number;
  surchargeLabel: string;
  /** Tips — Stripe has no native online tipping, so this is our own field. */
  tipsEnabled: boolean;
  tipPresets: number[];
  /**
   * The Stripe Terminal Location (`tml_…`) every Tap to Pay reader connects
   * under — one per business account, created from the default company's
   * address by `POST /terminal/location`. Never typed in, never an env var.
   */
  terminalLocationId?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  onlinePaymentsEnabled: false,
  cardEnabled: true,
  bankEnabled: false,
  bankMinimum: 20,
  allowPartial: true,
  surchargePercent: 0,
  surchargeLabel: 'Card processing fee',
  tipsEnabled: false,
  tipPresets: [10, 15, 20],
};

/** US card-network ceiling. Enforced server-side; Stripe rejects more anyway. */
export const MAX_SURCHARGE_PERCENT = 3;

/** What the portal needs to render a payment panel for one invoice. */
export interface PortalPaymentOptions {
  invoiceId: string;
  number: string;
  /** What is still owed, dollars. 0 ⇒ nothing to pay. */
  amountDue: number;
  /** Already taken but still clearing — shown as a note, not deducted. */
  amountPending: number;
  currency: string;
  methods: OnlinePaymentMethod[];
  allowPartial: boolean;
  /** Bank payments are refused below this. */
  bankMinimum: number;
  /** 0 when surcharging is off (the default). */
  surchargePercent: number;
  surchargeLabel: string;
  tipsEnabled: boolean;
  tipPresets: number[];
}

/** What the portal's "Make a deposit" step renders for one approved estimate. */
export interface PortalDepositOptions {
  estimateId: string;
  number: string;
  /** Workiz "Required deposit": the fixed amount, or the percent of the total. */
  depositDue: number;
  /** Deposit money already settled on this estimate. */
  amountPaid: number;
  /** What is still owed of the deposit, dollars. 0 ⇒ nothing to pay. */
  amountDue: number;
  /** Taken but still clearing (ACH). */
  amountPending: number;
  /** The client signed (approved) it — the deposit can only be taken after that. */
  signed: boolean;
  currency: string;
  methods: OnlinePaymentMethod[];
  allowPartial: boolean;
  bankMinimum: number;
  surchargePercent: number;
  surchargeLabel: string;
}

// ---- Stripe Terminal (Tap to Pay on a staff phone) -------------------------

/** `POST /terminal/connection-token` — what the Terminal SDK's token provider returns. Never cache it. */
export interface TerminalConnectionToken {
  secret: string;
}

/** `GET` / `POST /terminal/location` — the Location Tap to Pay readers connect under. */
export interface TerminalLocation {
  /** Stripe `tml_…`, for `connectReader({ locationId })`. `null` until one is created. */
  locationId: string | null;
  /** What it was created with (only on the `POST` that created it). */
  displayName?: string;
  address?: { line1: string; line2?: string; city: string; state: string; postalCode: string; country: string };
}

/** `POST /invoices/:id/terminal-intent` and `POST /estimates/:id/terminal-intent` (a deposit). */
export interface TerminalPaymentIntent {
  /** The ledger row — the request's `attemptId`. */
  paymentId: string;
  /** Stripe `pi_…`. */
  intentId: string;
  /** For the Terminal SDK's `retrievePaymentIntent(clientSecret)`. */
  clientSecret: string;
  /** Dollars toward the balance (or the deposit). */
  amount: number;
  /** Dollars on top, never toward the balance. */
  tipAmount: number;
  /**
   * Workiz's "Service fee": `surchargePercent` of `amount + tipAmount`, half-up
   * to the cent (`round2((amount + tip) × pct / 100)`). 0 when the account
   * charges none. Never toward the balance.
   */
  feeAmount: number;
  /** `amount + tipAmount + feeAmount` — what the card is charged. */
  total: number;
  currency: string;
  /** The row now: `pending` until the card is charged; a retried attempt may already be `settled`. */
  status: PaymentStatus;
}

/**
 * A Stripe PaymentIntent's own status, as the card-intent route answers it:
 * `succeeded` (the row is settled), `requires_action` (3-D Secure — the phone
 * runs `handleNextAction(clientSecret)`, then `…/sync`), `requires_payment_method`
 * (declined — ask for another card under a NEW attempt id), `processing`, `canceled`.
 */
export type KeyedIntentStatus =
  | 'succeeded'
  | 'processing'
  | 'requires_action'
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_capture'
  | 'canceled';

/**
 * `POST /invoices/:id/card-intent` and `POST /estimates/:id/card-intent` (a
 * deposit) — "Type card manually". HTTP 200 for every Stripe outcome.
 */
export interface KeyedPaymentIntent {
  /** The ledger row — the request's `attemptId`. */
  paymentId: string;
  /** Stripe `pi_…`. */
  intentId: string;
  /** For `handleNextAction(clientSecret)` when `status` is `requires_action`. */
  clientSecret: string;
  /** What Stripe says the intent is now (not the row's status). */
  status: KeyedIntentStatus;
  /** Dollars toward the balance (or the deposit). */
  amount: number;
  /** Dollars on top, never toward the balance. */
  tipAmount: number;
  /** The service fee — `round2((amount + tip) × surchargePercent / 100)`; 0 when the account charges none. */
  feeAmount: number;
  /** `amount + tipAmount + feeAmount` — what the card is charged. */
  total: number;
  currency: string;
  /** Why the card was not charged (Stripe's decline message) — with `requires_payment_method` / `canceled`. */
  declineMessage?: string;
}

/** `POST /terminal-intents/:paymentId/sync` and `…/cancel`: the attempt now, and its job's ledger. */
export interface TerminalIntentOutcome {
  payment: Payment;
  ledger: JobPaymentLedger;
}

/** How `POST /payments/:paymentId/receipt` may send a receipt. */
export const PAYMENT_RECEIPT_CHANNELS = ['email', 'sms'] as const;
export type PaymentReceiptChannel = (typeof PAYMENT_RECEIPT_CHANNELS)[number];

/**
 * `POST /payments/:paymentId/receipt` body (Workiz "Send a receipt?", whose
 * Email field is editable). No body: the client's first number, else their
 * first email. `channel` alone: the client's own address of that kind. With
 * `to` (needs `channel`): that address — an email (taken onto the client's
 * thread when it is new to it), or an E.164 number.
 */
export interface PaymentReceiptRequest {
  channel?: PaymentReceiptChannel;
  to?: string;
}

/** `POST /payments/:paymentId/receipt` — `sent: false` when there is nowhere to send it. */
export interface PaymentReceiptResult {
  sent: boolean;
  sentTo?: string;
}

/** Created per payment attempt — never baked into the emailed link (24h expiry). */
export interface PortalPaymentSession {
  /** Stripe Checkout Session client secret, for the embedded Payment Element. */
  clientSecret: string;
  publishableKey: string;
  paymentId: string;
  amount: number;
  surcharge: number;
  tip: number;
  total: number;
  currency: string;
}
