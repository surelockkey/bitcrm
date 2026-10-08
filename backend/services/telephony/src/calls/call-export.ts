import { DEFAULT_TIMEZONE } from '@bitcrm/types';
import { type MaybeMaskedCall } from './call-masking';
import { type CallPartyRef } from './party-resolver';
import { formatTrackedNumber } from './tracking/call-tracking';

/**
 * Workiz's "Export" on the call log, as rows of text — no I/O here; the
 * controller walks the log and hands each page over already named and masked
 * the way the list serves it.
 *
 * The columns are Workiz's own (`csv_columns` of `/node-voice/calls/report/`,
 * discovery requests.jsonl): Status, From, To, Time, Call Flow, Ad Source,
 * Tags, Answered By, Jobs & Leads, Revenue. Revenue is dropped without
 * `financials.view`, the numbers without `contacts.view_numbers` (the call
 * arrives masked), exactly as the grid draws them.
 */
const COLUMNS = ['Status', 'From', 'To', 'Time', 'Call Flow', 'Ad Source', 'Tags', 'Answered By', 'Jobs & Leads'];

/** Everything a row prints that is not on the call itself. */
export interface CallCsvContext {
  /** The viewer holds `financials.view` — the Revenue column exists. */
  money: boolean;
  /** Job source (Workiz ad group) id → its name. */
  sourceName: (id: string) => string | undefined;
  /** Call-tag id → its name. */
  tagName: (id: string) => string | undefined;
  /** Deal id → its job number ("375982"). */
  jobNumber: (id: string) => string | undefined;
  /** Deal id → its total. */
  jobTotal: (id: string) => number | undefined;
  timeZone?: string;
}

/** What an imported row adds beyond `CallRecord` (Workiz's raw names and serial). */
type ExportCall = MaybeMaskedCall & { answeredByName?: string; jobSerial?: number | string };

export function callCsvHeader(money: boolean): string {
  return [...COLUMNS, ...(money ? ['Revenue'] : [])].map((c) => csvField(c)).join(',');
}

/**
 * One CSV field. Quoted when it must be; a text cell a spreadsheet would run
 * as a formula (`=`, `+`, `-`, `@`) is defused with a leading `'` (the jobs
 * report's rule).
 */
export function csvField(value: string, numeric = false): string {
  let v = value;
  if (!numeric && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const LIVE = new Set(['queued', 'initiated', 'ringing', 'in-progress']);

/**
 * The Status column: the words of Workiz's glyph tooltip (Active call,
 * Incoming call, Missed call, Outgoing call, No answer) — the web's
 * `callStatusIcon`, so the file says what the grid shows.
 */
export function callStatusWords(call: Pick<ExportCall, 'direction' | 'status' | 'answeredAt'>): string {
  if (call.status && LIVE.has(call.status)) return 'Active call';
  const answered = !!call.answeredAt || call.status === 'completed';
  if (call.direction === 'inbound') return answered ? 'Incoming call' : 'Missed call';
  return answered ? 'Outgoing call' : 'No answer';
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** "Thu Oct 8th, 3:15PM" on the account clock — Workiz's `created`, the grid's Time. */
export function formatWzCallTime(iso: string | undefined, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const p: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(at)) p[part.type] = part.value;
  return `${p.weekday} ${p.month} ${ordinal(Number(p.day))}, ${p.hour}:${p.minute}${p.dayPeriod}`;
}

/** A side as the grid draws it: the name, then the number (none when masked or a browser leg). */
function partyCell(party: CallPartyRef | undefined, number: string | undefined): string {
  const digits = number && !number.startsWith('client:') ? formatTrackedNumber(number) : '';
  return [party?.name, digits].filter(Boolean).join(' ');
}

/** Who picked up: the answering participant, an inbound call's teammate, else Workiz's own record. */
function answeredBy(call: ExportCall): string {
  const answered = call.participants?.find((p) => p.role === 'answered');
  if (answered?.name) return answered.name;
  if (call.direction === 'inbound' && call.toParty?.kind === 'user' && call.toParty.name) return call.toParty.name;
  return call.answeredByName ?? '';
}

export function callCsvRow(call: ExportCall, ctx: CallCsvContext): string {
  const tags = (call.tagIds ?? [])
    .map((id) => ctx.tagName(id))
    .filter((n): n is string => !!n)
    .join(', ');
  const number = call.dealId ? ctx.jobNumber(call.dealId) : undefined;
  const serial = call.jobSerial !== undefined && `${call.jobSerial}` !== '' ? `${call.jobSerial}` : undefined;
  const job = number ?? serial;
  const cells: Array<[string, boolean?]> = [
    [callStatusWords(call)],
    [partyCell(call.fromParty, call.from)],
    [partyCell(call.toParty, call.to)],
    [formatWzCallTime(call.startedAt, ctx.timeZone)],
    [call.flowName?.trim() ?? ''],
    [call.sourceId ? (ctx.sourceName(call.sourceId) ?? '') : ''],
    [tags],
    [answeredBy(call)],
    [job ? `Job ${job}` : ''],
  ];
  if (ctx.money) {
    const total = call.dealId ? ctx.jobTotal(call.dealId) : undefined;
    // Workiz leaves a job with nothing billed blank.
    cells.push([total ? total.toFixed(2) : '', true]);
  }
  return cells.map(([v, numeric]) => csvField(v, numeric)).join(',');
}
