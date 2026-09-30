import {
  JobSuperStatus,
  JOBS_REPORT_COLUMNS,
  STAGE_TO_SUPER_STATUS,
  type DealStage,
  type JobTagColor,
  type JobsReportBy,
  type JobsReportColumnId,
  type JobsReportFilters,
  type JobsReportOrigin,
  type JobsReportPagination,
  type JobsReportRow,
} from '@bitcrm/types';
import { createdAt as createdWall, jobEndAt, jobStartAt, type ReportDateSource } from './report-dates';

/**
 * The Jobs report's own logic — pure, so the endpoint, the CSV export and
 * the offline check against Workiz's numbers (`scripts/verify-jobs-report.ts`)
 * run exactly the same code over a window of deal rows.
 *
 *   window rows ─ toReportDeal ─▶ ReportDeal ─ matchesFilters ─▶ toRow ─▶ sort / search ─▶ page | CSV
 */

/**
 * What a window read asks DynamoDB for. Imported rows carry some 150
 * attributes (notes, commission snapshots, custom fields…); the report needs
 * these, and nothing else crosses the wire or sits in the window cache.
 */
export const REPORT_PROJECTION: readonly string[] = [
  'PK',
  'SK',
  'id',
  'status',
  'dealNumber',
  'jobSerial',
  'jobName',
  'contactId',
  'clientName',
  'clientCompanyName',
  'tagIds',
  'jobTypeId',
  'createdAt',
  'scheduledDate',
  'scheduledEndDate',
  'scheduledTimeSlot',
  'allDay',
  'jobDateUtc',
  'jobEndDateUtc',
  'jobTimezone',
  'primaryPhone',
  'phones',
  'emailAddress',
  'superStatus',
  'stage',
  'subStatusId',
  'assignedTechIds',
  'createdBy',
  'userCreated',
  'address',
  'serviceArea',
  'serviceAreaId',
  'totals',
  'jobTotalPrice',
  'jobAmountDue',
  'sourceId',
  'externalCompanyId',
  'converted',
  'leadCreatedAt',
];

/** A job as the report holds it between the read and the page — compact, dates on the account clock. */
export interface ReportDeal {
  id: string;
  jobNumber: string;
  jobSerial?: number;
  jobName?: string;
  contactId: string;
  /** The per-job client name ("Just here" edit / Workiz job name), when the job has one. */
  clientName?: string;
  clientCompany?: string;
  tagIds: string[];
  jobTypeId?: string;
  /** ISO instant. */
  createdAt: string;
  /** Account wall clock (`YYYY-MM-DDTHH:MM`). */
  created?: string;
  scheduled?: string;
  end?: string;
  phone?: string;
  email?: string;
  superStatus: JobSuperStatus;
  subStatusId?: string;
  techIds: string[];
  createdBy?: string;
  /** Workiz's own "Created by" text, kept for a creator user-service no longer names. */
  userCreated?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  serviceAreaId?: string;
  serviceArea?: string;
  /** What the job is worth — `totals.total`; 0 for a job never priced. */
  total: number;
  amountDue?: number;
  sourceId?: string;
  externalCompanyId?: string;
  origin: JobsReportOrigin;
  leadCreated?: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A window row (any subset of a deal METADATA item) → the report's compact job. */
export function toReportDeal(item: Record<string, unknown>): ReportDeal {
  const dates = item as ReportDateSource;
  const address = (item.address ?? {}) as Record<string, unknown>;
  const totals = (item.totals ?? {}) as Record<string, unknown>;
  const clientName = item.clientName as { firstName?: string; lastName?: string } | undefined;
  const override = clientName ? `${clientName.firstName ?? ''} ${clientName.lastName ?? ''}`.trim() : '';
  const phones = Array.isArray(item.phones) ? (item.phones as unknown[]) : [];
  return {
    id: String(item.id ?? ''),
    jobNumber: String(item.dealNumber ?? ''),
    jobSerial: num(item.jobSerial),
    jobName: str(item.jobName),
    contactId: String(item.contactId ?? ''),
    clientName: override || undefined,
    clientCompany: str(item.clientCompanyName),
    tagIds: Array.isArray(item.tagIds) ? (item.tagIds as string[]) : [],
    jobTypeId: str(item.jobTypeId),
    createdAt: String(item.createdAt ?? ''),
    created: createdWall(dates),
    scheduled: jobStartAt(dates),
    end: jobEndAt(dates),
    phone: str(item.primaryPhone) ?? str(phones[0]),
    email: str(item.emailAddress),
    superStatus:
      (item.superStatus as JobSuperStatus | undefined) ??
      STAGE_TO_SUPER_STATUS[item.stage as DealStage] ??
      JobSuperStatus.SUBMITTED,
    subStatusId: str(item.subStatusId),
    techIds: Array.isArray(item.assignedTechIds) ? (item.assignedTechIds as string[]) : [],
    createdBy: str(item.createdBy),
    userCreated: str(item.userCreated),
    street: str(address.street),
    city: str(address.city),
    state: str(address.state),
    zip: str(address.zip),
    serviceAreaId: str(item.serviceAreaId),
    serviceArea: str(item.serviceArea),
    // The job's own snapshot (the Workiz import writes Workiz's figures into
    // it, source "workiz"); the importer's flat copy covers a row without one.
    total: num(totals.total) ?? num(item.jobTotalPrice) ?? 0,
    amountDue: num(totals.amountDue) ?? num(item.jobAmountDue),
    sourceId: str(item.sourceId),
    externalCompanyId: str(item.externalCompanyId),
    origin: item.converted === true ? 'lead' : 'new',
    leadCreated: str(item.leadCreatedAt),
  };
}

/** The account-calendar day a compact job is reported on. */
export function dayOfReport(d: ReportDeal, by: JobsReportBy): string | undefined {
  const at = by === 'created' ? d.created : by === 'scheduled' ? d.scheduled : d.end;
  return at?.slice(0, 10);
}

/** Inside `from`..`to` (inclusive days) on the chosen date. */
export function inWindow(d: ReportDeal, by: JobsReportBy, from: string, to: string): boolean {
  const day = dayOfReport(d, by);
  return day !== undefined && day >= from && day <= to;
}

/* ----------------------------------------------------------------- filters */

const some = (list: string[] | undefined, pick: (v: string) => boolean): boolean =>
  !list || list.length === 0 || list.some(pick);

/**
 * Workiz's MultiFilter: every group narrows (AND), a group matches when any
 * of its values does (OR). A status value is `done` or `done:<subStatusId>`.
 */
export function matchesFilters(d: ReportDeal, f: JobsReportFilters): boolean {
  return (
    some(f.status, (v) => {
      const [sup, sub] = v.split(':');
      return d.superStatus === sup && (!sub || d.subStatusId === sub);
    }) &&
    some(f.techId, (v) => d.techIds.includes(v)) &&
    some(f.createdBy, (v) => d.createdBy === v) &&
    some(f.tagId, (v) => d.tagIds.includes(v)) &&
    some(f.jobTypeId, (v) => d.jobTypeId === v) &&
    some(f.origin, (v) => d.origin === v) &&
    some(f.sourceId, (v) => d.sourceId === v) &&
    some(f.serviceAreaId, (v) => d.serviceAreaId === v) &&
    some(f.externalCompanyId, (v) => d.externalCompanyId === v)
  );
}

/* ------------------------------------------------------------------- rows */

export const SUPER_STATUS_LABEL: Record<JobSuperStatus, string> = {
  [JobSuperStatus.SUBMITTED]: 'Submitted',
  [JobSuperStatus.IN_PROGRESS]: 'In Progress',
  [JobSuperStatus.DONE]: 'Done',
  [JobSuperStatus.PENDING]: 'Pending',
  [JobSuperStatus.DONE_PENDING_APPROVAL]: 'Done Pending Approval',
  [JobSuperStatus.CANCELED]: 'Canceled',
};

/** Names for the ids a job carries. A miss prints as blank, never as an id. */
export interface ReportLookups {
  jobTypes: Map<string, string>;
  sources: Map<string, string>;
  tags: Map<string, { name: string; color?: JobTagColor }>;
  subStatuses: Map<string, string>;
  serviceAreas: Map<string, string>;
  externalCompanies: Map<string, string>;
  /** Users (technicians and creators) by id. */
  users: Map<string, string>;
  /** Clients by contact id — resolved only for the rows that need them. */
  clients: Map<string, string>;
}

export const emptyLookups = (): ReportLookups => ({
  jobTypes: new Map(),
  sources: new Map(),
  tags: new Map(),
  subStatuses: new Map(),
  serviceAreas: new Map(),
  externalCompanies: new Map(),
  users: new Map(),
  clients: new Map(),
});

export interface RowOptions {
  /** `financials.view` — without it the money columns are left out. */
  money: boolean;
  /** `contacts.view_numbers` — without it the phone is withheld. */
  numbers: boolean;
}

/** A compact job → the row the page and the CSV print. */
export function toRow(d: ReportDeal, lk: ReportLookups, opts: RowOptions): JobsReportRow {
  const tags = d.tagIds.map((id) => ({ id, ...(lk.tags.get(id) ?? { name: '' }) })).filter((t) => t.name);
  return {
    id: d.id,
    jobNumber: d.jobNumber,
    jobName: d.jobName,
    contactId: d.contactId,
    client: d.clientName ?? lk.clients.get(d.contactId) ?? '',
    clientCompany: d.clientCompany,
    tags,
    jobTypeId: d.jobTypeId,
    type: (d.jobTypeId && lk.jobTypes.get(d.jobTypeId)) || '',
    createdAt: d.createdAt,
    scheduled: d.scheduled,
    end: d.end,
    ...(d.phone && (opts.numbers ? { phone: d.phone } : { phoneMasked: true })),
    email: d.email,
    superStatus: d.superStatus,
    status: SUPER_STATUS_LABEL[d.superStatus] ?? d.superStatus,
    subStatusId: d.subStatusId,
    subStatus: (d.subStatusId && lk.subStatuses.get(d.subStatusId)) || undefined,
    techIds: d.techIds,
    tech: d.techIds.map((id) => lk.users.get(id) ?? '').filter(Boolean),
    createdById: d.createdBy,
    createdBy: (d.createdBy && lk.users.get(d.createdBy)) || d.userCreated || '',
    address: d.street,
    city: d.city,
    state: d.state,
    zip: d.zip,
    serviceAreaId: d.serviceAreaId,
    serviceArea: (d.serviceAreaId && lk.serviceAreas.get(d.serviceAreaId)) || d.serviceArea || undefined,
    ...(opts.money && { total: d.total, amountDue: d.amountDue }),
    sourceId: d.sourceId,
    source: (d.sourceId && lk.sources.get(d.sourceId)) || undefined,
    externalCompanyId: d.externalCompanyId,
    externalCompany: (d.externalCompanyId && lk.externalCompanies.get(d.externalCompanyId)) || undefined,
    leadCreated: d.leadCreated,
    origin: d.origin,
  };
}

/* ----------------------------------------------------------------- search */

const digitsOf = (s: string): string => s.replace(/\D/g, '');

/**
 * The search box: any part of the job number, job name, client, phone,
 * email or address. A query of digits also matches a phone however it is
 * written.
 */
export function matchesSearch(row: JobsReportRow, q: string, serial?: number): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    row.jobNumber,
    serial !== undefined ? String(serial) : '',
    row.jobName,
    row.client,
    row.clientCompany,
    row.email,
    row.phone,
    row.address,
    row.city,
    row.state,
    row.zip,
  ];
  if (hay.some((v) => v && v.toLowerCase().includes(needle))) return true;
  const digits = digitsOf(needle);
  return digits.length >= 3 && digits.length === needle.replace(/[\s()+.-]/g, '').length
    ? Boolean(row.phone && digitsOf(row.phone).includes(digits))
    : false;
}

/* ------------------------------------------------------------------- sort */

/** What a column sorts on — its printed text, or the number for Total. */
export function sortKey(row: JobsReportRow, column: JobsReportColumnId): string | number {
  switch (column) {
    case 'jobNumber': return row.jobNumber;
    case 'jobName': return row.jobName ?? '';
    case 'client': return row.client;
    case 'tags': return row.tags.map((t) => t.name).join(', ');
    case 'type': return row.type;
    case 'created': return row.createdAt;
    case 'scheduled': return row.scheduled ?? '';
    case 'end': return row.end ?? '';
    case 'phone': return row.phone ?? '';
    case 'email': return row.email ?? '';
    case 'status': return `${row.status} ${row.subStatus ?? ''}`;
    case 'tech': return row.tech.join(', ');
    case 'createdBy': return row.createdBy;
    case 'address': return row.address ?? '';
    case 'city': return row.city ?? '';
    case 'state': return row.state ?? '';
    case 'zip': return row.zip ?? '';
    case 'serviceArea': return row.serviceArea ?? '';
    case 'total': return row.total ?? 0;
    case 'source': return row.source ?? '';
    case 'externalCompany': return row.externalCompany ?? '';
    case 'leadCreated': return row.leadCreated ?? '';
    case 'origin': return row.origin;
    default: return '';
  }
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * Server-side sort on any column, newest-created first among equals — the
 * report's default order (`created desc`) is also every tie's.
 */
export function sortRows(rows: JobsReportRow[], column: JobsReportColumnId, dir: 'asc' | 'desc'): JobsReportRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const keyed = rows.map((row) => ({ row, key: sortKey(row, column) }));
  keyed.sort((a, b) => {
    const c =
      typeof a.key === 'number' && typeof b.key === 'number'
        ? a.key - b.key
        : column === 'created'
          ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
          : collator.compare(String(a.key), String(b.key));
    if (c !== 0) return c * sign;
    if (a.row.createdAt !== b.row.createdAt) return a.row.createdAt < b.row.createdAt ? 1 : -1;
    return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
  });
  return keyed.map((k) => k.row);
}

/* ------------------------------------------------------------------- page */

export function paginate<T>(rows: T[], page: number, pageSize: number): { rows: T[]; pagination: JobsReportPagination } {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  return {
    rows: slice,
    pagination: {
      page: p,
      pageSize,
      total,
      pages,
      from: slice.length ? start + 1 : 0,
      to: start + slice.length,
    },
  };
}

/* -------------------------------------------------------------------- CSV */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Workiz's date cell: `Tue Sep 29, 2026 02:35 pm` from an account wall clock
 * (`YYYY-MM-DDTHH:MM`), or `Tue Sep 29, 2026` for a bare day.
 */
export function workizDate(wall: string | undefined): string {
  if (!wall || !/^\d{4}-\d{2}-\d{2}/.test(wall)) return '';
  const [y, m, d] = wall.slice(0, 10).split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const day = `${weekday} ${MONTHS[m - 1]} ${String(d).padStart(2, '0')}, ${y}`;
  const time = wall.slice(11, 16);
  if (!/^\d{2}:\d{2}$/.test(time)) return day;
  const [h, min] = time.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${day} ${String(h12).padStart(2, '0')}:${String(min).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** A US number as people read it; anything else as stored. */
export function formatPhone(phone: string | undefined): string {
  if (!phone) return '';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

/** The printed text of one cell — shared by the CSV and nothing else, so the file reads like the grid. */
export function cellText(row: JobsReportRow, column: JobsReportColumnId): string {
  switch (column) {
    case 'jobNumber': return row.jobNumber;
    case 'jobName': return row.jobName ?? '';
    case 'client': return row.clientCompany && row.clientCompany !== row.client ? `${row.client} (${row.clientCompany})`.trim() : row.client;
    case 'tags': return row.tags.map((t) => t.name).join(', ');
    case 'type': return row.type;
    case 'created': return workizDate(createdWall({ createdAt: row.createdAt }));
    case 'scheduled': return workizDate(row.scheduled);
    case 'end': return workizDate(row.end);
    case 'phone': return formatPhone(row.phone);
    case 'email': return row.email ?? '';
    case 'status': return row.subStatus ? `${row.status} - ${row.subStatus}` : row.status;
    case 'tech': return row.tech.join(', ');
    case 'createdBy': return row.createdBy;
    case 'address': return row.address ?? '';
    case 'city': return row.city ?? '';
    case 'state': return row.state ?? '';
    case 'zip': return row.zip ?? '';
    case 'serviceArea': return row.serviceArea ?? '';
    case 'total': return row.total === undefined ? '' : row.total.toFixed(2);
    case 'source': return row.source ?? '';
    case 'externalCompany': return row.externalCompany ?? '';
    case 'leadCreated': return workizDate(createdWall({ createdAt: row.leadCreated }));
    case 'origin': return row.origin === 'lead' ? 'Lead' : 'New';
    default: return '';
  }
}

/**
 * One CSV field. Quoted when it must be; a text cell that a spreadsheet
 * would run as a formula (`=`, `+`, `-`, `@`) is defused with a leading `'`.
 */
export function csvField(value: string, numeric = false): string {
  let v = value;
  if (!numeric && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const LABEL = new Map<string, string>(JOBS_REPORT_COLUMNS.map((c) => [c.id, c.label]));

export function csvHeader(columns: readonly JobsReportColumnId[]): string {
  return columns.map((c) => csvField(LABEL.get(c) ?? c)).join(',');
}

export function csvLine(row: JobsReportRow, columns: readonly JobsReportColumnId[]): string {
  return columns.map((c) => csvField(cellText(row, c), c === 'total')).join(',');
}
