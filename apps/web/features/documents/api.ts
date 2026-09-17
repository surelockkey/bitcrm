import type {
  DocumentPageSettings,
  DocumentRow,
  DocumentTemplate,
  DocumentTemplateContent,
  DocumentTemplateKind,
  DocumentTemplateSummary,
  DocumentVisibility,
} from "@bitcrm/types";
import { formatMoney, type DocumentPresetId } from "@bitcrm/document-renderer";
import { http } from "@/lib/api/http";
import { ApiError } from "@/lib/api/errors";
import type { NewTemplateValues } from "./schemas";

const T = "/billing/templates";

/* -------------------------------------------------------------- templates */

export interface TemplateUpdateBody {
  name?: string;
  autoApply?: { jobTypeIds: string[]; serviceAreaIds: string[]; businessProfileIds: string[] };
  page: DocumentPageSettings;
  header: DocumentRow[];
  body: DocumentRow[];
  footer: DocumentRow[];
  visibility: DocumentVisibility;
  version: number;
}

export interface DocumentPreset {
  id: DocumentPresetId;
  name: string;
  description: string;
}

export const listTemplates = (): Promise<DocumentTemplateSummary[]> => http.get<DocumentTemplateSummary[]>(T);
export const getTemplate = (id: string): Promise<DocumentTemplate> => http.get<DocumentTemplate>(`${T}/${id}`);
export const createTemplate = (body: NewTemplateValues): Promise<DocumentTemplate> => http.post<DocumentTemplate>(T, body);
export const updateTemplate = (id: string, body: TemplateUpdateBody): Promise<DocumentTemplate> =>
  http.put<DocumentTemplate>(`${T}/${id}`, body);
export const duplicateTemplate = (id: string): Promise<DocumentTemplate> => http.post<DocumentTemplate>(`${T}/${id}/duplicate`);
export const setDefaultTemplate = (id: string): Promise<DocumentTemplate> => http.post<DocumentTemplate>(`${T}/${id}/default`);
export const deleteTemplate = (id: string): Promise<unknown> => http.delete<unknown>(`${T}/${id}`);
export const listPresets = (): Promise<DocumentPreset[]> => http.get<DocumentPreset[]>(`${T}/presets`);

export interface PreviewSource {
  kind: "invoice" | "estimate";
  id: string;
}

export interface RenderRequest {
  kind: DocumentTemplateKind;
  content: DocumentTemplateContent;
  source?: PreviewSource;
}

export const renderTemplateHtml = async (req: RenderRequest): Promise<string> =>
  (await http.post<{ html: string }>(`${T}/render`, { ...req, format: "html" })).html;

export const renderTemplatePdf = async (req: RenderRequest): Promise<string> =>
  (await http.post<{ url: string }>(`${T}/render`, { ...req, format: "pdf" })).url;

/* ------------------------------------------------------------------ assets */

export interface AssetUploadTicket {
  id: string;
  uploadUrl: string;
  headers?: Record<string, string>;
}

export const requestAssetUpload = (body: { contentType: string; fileName?: string; size?: number }): Promise<AssetUploadTicket> =>
  http.post<AssetUploadTicket>("/billing/assets", body);

export const getAssetUrl = async (id: string): Promise<string> =>
  (await http.get<{ url: string }>(`/billing/assets/${encodeURIComponent(id)}/url`)).url;

/** Why an upload to storage failed — shown to the user verbatim. */
export class AssetUploadError extends Error {
  constructor(
    readonly reason: "network" | "http",
    readonly status?: number,
  ) {
    super(
      reason === "network"
        ? "Upload blocked — storage CORS/network error. The storage bucket must allow uploads from this site."
        : `Upload failed — storage answered HTTP ${status}.`,
    );
    this.name = "AssetUploadError";
  }
}

function putHeaders(ticket: AssetUploadTicket, file: File): Record<string, string> {
  return ticket.headers && Object.keys(ticket.headers).length ? ticket.headers : { "Content-Type": file.type };
}

function putWithProgress(ticket: AssetUploadTicket, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", ticket.uploadUrl);
    for (const [k, v] of Object.entries(putHeaders(ticket, file))) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new AssetUploadError("http", xhr.status));
      }
    };
    // A CORS rejection and a dropped connection look identical from here.
    xhr.onerror = () => reject(new AssetUploadError("network"));
    xhr.onabort = () => reject(new AssetUploadError("network"));
    xhr.send(file);
  });
}

/**
 * Uploads an image and returns its asset id. The presigned PUT is signed with
 * the headers the API returns (SSE-KMS), so they must be sent verbatim. Pass
 * `onProgress` (0–100) to track the upload (uses XHR — fetch can't report it).
 * Storage failures throw `AssetUploadError` naming the reason.
 */
export async function uploadAsset(file: File, onProgress?: (percent: number) => void): Promise<string> {
  const ticket = await requestAssetUpload({ contentType: file.type, fileName: file.name, size: file.size });
  if (onProgress && typeof XMLHttpRequest !== "undefined") {
    onProgress(0);
    await putWithProgress(ticket, file, onProgress);
    return ticket.id;
  }
  let res: Response;
  try {
    res = await fetch(ticket.uploadUrl, { method: "PUT", headers: putHeaders(ticket, file), body: file });
  } catch {
    throw new AssetUploadError("network");
  }
  if (!res.ok) throw new AssetUploadError("http", res.status);
  return ticket.id;
}

/* ------------------------------------------------- real-document previews */

export interface PreviewSourceOption extends PreviewSource {
  label: string;
  sublabel?: string;
}

interface BillingDocLite {
  id: string;
  number: string;
  name?: string;
  totals?: { total?: number };
  createdAt?: string;
}

function toOption(kind: PreviewSource["kind"], d: BillingDocLite): PreviewSourceOption {
  const title = kind === "invoice" ? "Invoice" : "Estimate";
  const total = typeof d.totals?.total === "number" ? formatMoney(d.totals.total) : undefined;
  const date = d.createdAt && !Number.isNaN(Date.parse(d.createdAt)) ? new Date(d.createdAt).toLocaleDateString() : undefined;
  return {
    kind,
    id: d.id,
    label: `${title} #${d.number}${d.name ? ` · ${d.name}` : ""}`,
    sublabel: [total, date].filter(Boolean).join(" · ") || undefined,
  };
}

/** Recent invoices/estimates matching a number (or an exact id) for "Preview with". */
export async function searchPreviewSources(kind: PreviewSource["kind"], query: string): Promise<PreviewSourceOption[]> {
  const base = kind === "invoice" ? "/billing/invoices" : "/billing/estimates";
  const q = query.trim().toLowerCase();
  const page = await http.get<{ items: BillingDocLite[] }>(`${base}?limit=100`);
  const matches = (page.items ?? [])
    .filter((d) => !q || d.number.toLowerCase().includes(q) || d.id.toLowerCase() === q)
    .slice(0, 20)
    .map((d) => toOption(kind, d));
  if (matches.length || !q || /\s/.test(q)) return matches;
  try {
    const exact = await http.get<BillingDocLite>(`${base}/${encodeURIComponent(query.trim())}`);
    return exact ? [toOption(kind, exact)] : [];
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return [];
    throw e;
  }
}
