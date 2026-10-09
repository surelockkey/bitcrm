"use client";

import { useRef } from "react";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { CompanyDocumentType, type Company } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzFormSectionTitle } from "@/components/workiz/form-section-title";
import { DEFAULT_TZ } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { workizDateTime, workizScheduleCell } from "@/features/deals/schedule-cell";
import { useCompanyDocuments, useUploadCompanyDocument, useDeleteCompanyDocument } from "../hooks";
import * as api from "../api";
import { coiStatus, paymentTermsLabel, type CoiStatus } from "../lib";
import { useFilePreviewStore } from "@/features/files/preview-store";

const DOC_LABELS: Record<CompanyDocumentType, string> = {
  [CompanyDocumentType.W9]: "W-9",
  [CompanyDocumentType.COI]: "COI (insurance)",
};
const DOC_TYPES = [CompanyDocumentType.W9, CompanyDocumentType.COI];

/** The COI's state in words, in Workiz's colours (toastr's warning, the danger red). */
const COI_WORDS: Record<Exclude<CoiStatus, "none">, { label: string; className: string }> = {
  valid: { label: "Valid", className: "text-foreground" },
  expiring: { label: "Expiring", className: "text-wz-toast-warning" },
  expired: { label: "Expired", className: "text-wz-danger" },
};

/** Workiz's blue words-button (the client page's "Pay unpaid invoices"): 14px/21px 500 #6aa8ee. */
const BLUE = "inline-flex items-center gap-1.5 text-sm leading-[21px] font-medium tracking-[0.4px] text-wz-link outline-none hover:underline focus-visible:underline disabled:opacity-60";
/** Workiz's 32px IconButton: 8px corners, #f3f6f7 under the pointer. */
const ICON_BUTTON = "grid size-8 shrink-0 place-items-center rounded-[8px] outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-ring/50";

/** "2026-12-31" → "Thu Dec 31, 2026", Workiz's day. */
const wzDay = (ymd: string) => workizScheduleCell({ scheduledDate: ymd }, "UTC").when;

/**
 * The company's terms and compliance papers (ours — Workiz keeps a client's
 * payment terms and tax status inside Edit client info), laid out as the
 * client page's left column and cards: "Payment" — Workiz's 10px capital
 * captions over 14px values (Payment terms, Tax exempt, PO required, COI
 * expiration with its state); "Compliance documents" — the W-9 and the COI
 * as Workiz's bordered cards (1px #dfe2e3, r5, 16px in), View for anyone,
 * Upload file / the bin for someone who may edit the company.
 *
 * The documents are asked for when the tab opens: the page does not open on it.
 */
export function CompanyComplianceTab({ company }: { company: Company }) {
  const { can } = usePermissions();
  const canEdit = can("companies", "edit");
  const docs = useCompanyDocuments(company.id);
  const del = useDeleteCompanyDocument(company.id);
  const coi = coiStatus(company.coiExpiration);

  return (
    <div className="px-[21px] pt-6 pb-10 text-sm leading-[21px] tracking-[0.4px] text-foreground">
      <WzFormSectionTitle>Payment</WzFormSectionTitle>
      <ul aria-label="Payment" className="mt-4 grid max-w-[760px] grid-cols-2 gap-x-10 gap-y-5 sm:grid-cols-4">
        <Term label="Payment terms">{paymentTermsLabel(company.paymentTerms, company.customTermsDays)}</Term>
        <Term label="Tax exempt">{company.taxExempt ? "Yes" : "No"}</Term>
        <Term label="PO required">{company.poRequired ? "Yes" : "No"}</Term>
        <Term label="COI expiration">
          {company.coiExpiration ? wzDay(company.coiExpiration) : "—"}
          {coi !== "none" ? <span className={COI_WORDS[coi].className}>{` · ${COI_WORDS[coi].label}`}</span> : null}
        </Term>
      </ul>

      <WzFormSectionTitle className="mt-10">Compliance documents</WzFormSectionTitle>
      <div className="mt-4 grid max-w-[760px] gap-4 sm:grid-cols-2">
        {DOC_TYPES.map((t) => {
          const present = docs.data?.find((d) => d.docType === t);
          const label = DOC_LABELS[t];
          return (
            <div key={t} role="group" aria-label={label} className="min-h-[130px] rounded-[5px] border border-border px-4 pt-[5px] pb-4">
              <div className="flex min-h-[42px] items-center justify-between">
                <div className="flex items-center gap-2 text-xs leading-[18px] font-semibold tracking-[0.4px]">
                  <FileText className="size-[18px]" strokeWidth={1.25} aria-hidden />
                  {label}
                </div>
                {present && canEdit ? (
                  <button
                    type="button"
                    aria-label={`Delete ${label}`}
                    title={`Delete ${label}`}
                    disabled={del.isPending}
                    onClick={() => del.mutate(t)}
                    className={cn(ICON_BUTTON, "-mr-[5px] text-wz-danger")}
                  >
                    <Trash2 className="size-[18px]" strokeWidth={1.25} />
                  </button>
                ) : null}
              </div>
              {docs.isLoading ? (
                <Skeleton className="mt-2.5 h-4 w-40" />
              ) : (
                <>
                  <p className={cn("mt-2.5 leading-4", present ? "text-wz-strong" : "text-wz-outline-label")}>
                    {present ? `Uploaded ${workizDateTime(present.uploadedAt, DEFAULT_TZ)}` : "Not uploaded"}
                  </p>
                  <div className="mt-4 flex items-center gap-5">
                    {present ? (
                      <button type="button" className={BLUE} onClick={() => view(company.id, t, label)}>
                        View
                      </button>
                    ) : null}
                    {!present && canEdit ? <UploadButton companyId={company.id} docType={t} /> : null}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One term: Workiz's 10px/14px 500 #9ea6aa capital caption over the 14px/21px value. */
function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col">
      <small className="text-[10px] leading-[14px] font-medium tracking-[0.4px] text-wz-outline uppercase">{label}</small>
      <span className="mt-2">{children}</span>
    </li>
  );
}

/** Відкрити документ компанії у вікні перегляду — як і будь-яке вкладення. */
function view(companyId: string, docType: CompanyDocumentType, name: string) {
  useFilePreviewStore.getState().preview({
    name,
    load: async () => (await api.getCompanyDocumentDownloadUrl(companyId, docType)).downloadUrl,
  });
}

/** Workiz's "Upload file" (the Files panel's words) over a hidden file input. */
function UploadButton({ companyId, docType }: { companyId: string; docType: CompanyDocumentType }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadCompanyDocument(companyId);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate({ docType, file: f });
          e.target.value = "";
        }}
      />
      <button type="button" className={BLUE} disabled={upload.isPending} onClick={() => inputRef.current?.click()}>
        {upload.isPending ? <Loader2 className="size-[18px] animate-spin" /> : <Upload className="size-[18px]" strokeWidth={1.25} />}
        Upload file
      </button>
    </>
  );
}
