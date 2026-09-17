/**
 * The money side of a job — shape only, on purpose.
 *
 * The owner's instruction for this wave: «інвойси і оплату поки замокай, вона
 * буде пізніше» — mock invoices and payment, they come later. So the Finance
 * tab and the Pay action exist, in Workiz's order and with Workiz's words
 * (`WORKIZ_MOBILE_APP.md` §1.4 for the sections, §1.8–§1.9 for what each of
 * them does), and they read from nothing at all.
 *
 * Three rules this file exists to enforce, in one place where they can be
 * tested:
 *
 *  1. **No number is ever invented.** Every figure is `EMPTY`. There is no
 *     sample total, no plausible balance, no seeded line item. A technician who
 *     glances at this tab and reads a dollar amount off it would quote that
 *     amount to a client; a dash cannot be misquoted.
 *  2. **Every mocked surface says so.** `NOT_CONNECTED` is one short line, at
 *     the top of the tab and again on the Pay sheet, in plain words.
 *  3. **Nothing is attributed to Workiz without a source.** The owner paused
 *     three pull requests over parity, so a row we invented and labelled as
 *     theirs is worse than a missing one: it is learned, defended, and wrong.
 *     Each list below says which line of the sources it came from, or says
 *     plainly that it is ours.
 *
 * When the invoice and payment APIs land, what changes here is where the values
 * come from. The order of the rows, their labels and the layout stay — that is
 * the point of building the skeleton now.
 */

/** What a figure with nothing behind it reads as. Never a zero: zero is a fact. */
export const EMPTY = '—';

/** The honest line at the top of the Finance tab. */
export const NOT_CONNECTED =
  'Not connected yet. Invoices and payments are still handled in the office — nothing on this tab is live.';

/** The same promise on the Pay sheet, where the stakes are higher. */
export const PAY_NOT_CONNECTED =
  'Taking payment is not connected yet. Nothing here charges anybody. Collect as you do today and tell the office.';

export interface FinanceFigure {
  key: 'invoiceNumber' | 'total' | 'balance';
  label: string;
  /** Always `EMPTY` this wave — see rule 1 above. */
  value: string;
}

/**
 * The summary line: the invoice's number, what the job comes to, what is still
 * owed.
 *
 * Ours, not Workiz's. No source in this repo records a summary row on their
 * Finance tab, and the live-capture pass never reached a job card at all — the
 * account it was read from has no assigned work
 * (`WORKIZ_APP_SCREENS_LIVE.md`, line 11). Kept because it is the first thing
 * a technician is asked at a door, and marked as ours because
 * `_MOBILE_UI_PARITY_REQUIREMENT.md` asks for a source behind every claim about
 * their app and there is none behind this one.
 */
export function financeFigures(): FinanceFigure[] {
  return [
    { key: 'invoiceNumber', label: 'Invoice', value: EMPTY },
    { key: 'total', label: 'Total', value: EMPTY },
    { key: 'balance', label: 'Balance', value: EMPTY },
  ];
}

export interface FinanceSection {
  key: 'jobItems' | 'estimates' | 'invoices' | 'payments' | 'documents';
  /** Workiz's own word for the section (§1.4). */
  label: string;
  /** What sits under the label while there is nothing behind it. */
  empty: string;
}

/**
 * The sections of Workiz's Finance tab, in the order the source records.
 *
 * `WORKIZ_MOBILE_APP.md` §1.4, verbatim: «Finance-вкладка: Job items,
 * Estimates, Invoices, Payments, Documents». That sentence is the whole of the
 * evidence for this tab, so the order and the words are its own, and nothing is
 * added to it. A "Payment schedule" row would be a guess at their screen drawn
 * as though it were a reading of one — and it would still be a guess after a
 * technician had learned where it sits.
 *
 * Every one is drawn, none is tappable. A row that opens nothing is worse than
 * a row that says it opens nothing — so these state their emptiness instead of
 * accepting a tap and answering with a blank screen.
 */
export function financeSections(): FinanceSection[] {
  return [
    { key: 'jobItems', label: 'Job items', empty: 'No items on this job' },
    { key: 'estimates', label: 'Estimates', empty: 'No estimates' },
    { key: 'invoices', label: 'Invoices', empty: 'No invoice on this job' },
    { key: 'payments', label: 'Payments', empty: 'No payments' },
    { key: 'documents', label: 'Documents', empty: 'No documents' },
  ];
}

export interface PayMethod {
  key: string;
  label: string;
  /** What this will do once payments are wired — said in the future tense. */
  note: string;
}

/**
 * What Pay will offer, listed rather than offered.
 *
 * The order is this account's own, not Workiz's marketing order: cash is 43 %
 * of the 34 171 payments taken from the app here, and card is next
 * (`WORKIZ_MOBILE_APP.md` §1.8). A plan that leads with Tap to Pay leads with
 * the method these technicians use least.
 *
 * Every line is future tense, because none of them does anything today.
 */
export function payMethods(): PayMethod[] {
  return [
    {
      key: 'cash',
      label: 'Cash',
      note: 'Will record what you took, against this job',
    },
    {
      key: 'check',
      label: 'Check',
      note: 'Will record the check number against this job',
    },
    {
      key: 'card',
      label: 'Card',
      note: 'Will read the card on the phone or a reader, and take a signature',
    },
    {
      key: 'link',
      label: 'Payment link',
      note: 'Will text or email the client a link they pay from',
    },
  ];
}
