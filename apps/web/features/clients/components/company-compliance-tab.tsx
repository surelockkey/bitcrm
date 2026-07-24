"use client";

import { useRef } from "react";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { CompanyDocumentType, type Company } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import {
  useCompanyDocuments,
  useUploadCompanyDocument,
  useDeleteCompanyDocument,
} from "../hooks";
import * as api from "../api";
import { coiStatus, paymentTermsLabel } from "../lib";
import { CoiStatusBadge } from "./client-badges";

const DOC_LABELS: Record<CompanyDocumentType, string> = {
  [CompanyDocumentType.W9]: "W-9",
  [CompanyDocumentType.COI]: "COI (insurance)",
};
const DOC_TYPES = [CompanyDocumentType.W9, CompanyDocumentType.COI];

export function CompanyComplianceTab({ company }: { company: Company }) {
  const { can } = usePermissions();
  const canEdit = can("companies", "edit");
  const { data: docs } = useCompanyDocuments(company.id);
  const del = useDeleteCompanyDocument(company.id);

  const coi = coiStatus(company.coiExpiration);

  return (
    <div className="max-w-2xl space-y-6">
      {/* Financial terms summary */}
      <section className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-3">
        <Summary label="Payment terms" value={paymentTermsLabel(company.paymentTerms, company.customTermsDays)} />
        <Summary label="Tax exempt" value={company.taxExempt ? "Yes" : "No"} />
        <Summary label="PO required" value={company.poRequired ? "Yes" : "No"} />
        <Summary
          label="COI expiration"
          value={company.coiExpiration || "—"}
          extra={<CoiStatusBadge status={coi} />}
        />
      </section>

      {/* Compliance documents */}
      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Compliance documents
        </div>
        <div className="grid grid-cols-2 gap-3">
          {DOC_TYPES.map((t) => {
            const present = docs?.find((d) => d.docType === t);
            return (
              <div key={t} className={cn("flex flex-col gap-2 rounded-lg border p-3", !present && "border-dashed")}>
                <div className="grid h-14 place-items-center rounded-md bg-muted text-muted-foreground">
                  <FileText className="size-5" />
                </div>
                <div className="text-xs font-medium">{DOC_LABELS[t]}</div>
                {present ? (
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" className="h-7 flex-1 text-xs" onClick={() => view(company.id, t)}>
                      View
                    </Button>
                    {canEdit ? (
                      <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => del.mutate(t)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ) : canEdit ? (
                  <UploadButton companyId={company.id} docType={t} />
                ) : (
                  <span className="text-[11px] text-muted-foreground">Not uploaded</span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function view(companyId: string, docType: CompanyDocumentType) {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  void (async () => {
    try {
      const { downloadUrl } = await api.getCompanyDocumentDownloadUrl(companyId, docType);
      if (tab) tab.location.replace(downloadUrl);
      else window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } catch {
      tab?.close();
    }
  })();
}

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
      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={upload.isPending} onClick={() => inputRef.current?.click()}>
        {upload.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
        Upload
      </Button>
    </>
  );
}

function Summary({ label, value, extra }: { label: string; value: string; extra?: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2 text-sm">
        {value}
        {extra}
      </div>
    </div>
  );
}
