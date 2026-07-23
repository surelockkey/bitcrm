"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileText, Loader2, ShieldAlert, Trash2, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { DocumentType } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/users/lib";
import { usePermissions } from "@/features/auth/use-permissions";
import * as api from "../api";
import {
  useDocuments,
  useSensitive,
  useAudit,
  useDeleteDocument,
  useSetSensitive,
  useUploadDocument,
  useUserMap,
} from "../hooks";
import { DOC_TYPES, docLabel, auditLabel, auditActorLabel } from "../lib";
import { sensitiveSchema, type SensitiveValues } from "../schemas";

export function DocumentsTab({ technicianId }: { technicianId: string }) {
  const { me, can } = usePermissions();
  const qc = useQueryClient();
  const { data: docs, isLoading } = useDocuments(technicianId);
  const { data: sensitive } = useSensitive(technicianId);
  const { data: audit } = useAudit(technicianId);
  const { data: userMap } = useUserMap();
  const del = useDeleteDocument();
  const [viewing, setViewing] = useState<DocumentType | null>(null);
  const [sensitiveOpen, setSensitiveOpen] = useState(false);

  const isSelf = me?.id === technicianId;
  const canUpload = isSelf && can("documents", "upload");
  const canDelete = can("documents", "delete");

  const view = (docType: DocumentType) => {
    // Open the tab synchronously, inside the click gesture. Opening it after the
    // `await` below would count as a non-user-initiated popup — browsers block
    // it and you get a blank (black, in dark mode) tab instead of the document.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null; // keep the noopener guarantee we had before
    setViewing(docType);
    void (async () => {
      try {
        const { downloadUrl } = await api.getDocumentDownloadUrl(technicianId, docType);
        if (tab) tab.location.replace(downloadUrl);
        else window.open(downloadUrl, "_blank", "noopener,noreferrer"); // popup blocked outright
        qc.invalidateQueries({ queryKey: queryKeys.technicians.audit(technicianId) });
      } catch (e) {
        tab?.close();
        toast.error(getApiErrorMessage(e));
      } finally {
        setViewing(null);
      }
    })();
  };

  if (isLoading) return <Skeleton className="h-72 w-full" />;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-500">
        <ShieldAlert className="mt-0.5 size-4 flex-none" />
        <span>
          Sensitive. Documents open via a short-lived link in a new tab; nothing is
          cached. Every view, upload, and delete is written to the audit trail below.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {DOC_TYPES.map((t) => {
          const present = docs?.find((d) => d.docType === t);
          return (
            <div key={t} className={cn("flex flex-col gap-2 rounded-lg border p-3", !present && "border-dashed")}>
              <div className="grid h-16 place-items-center rounded-md bg-muted text-muted-foreground">
                <FileText className="size-5" />
              </div>
              <div className="text-xs font-medium">{docLabel(t)}</div>
              {present ? (
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" className="h-7 flex-1 text-xs" disabled={viewing === t} onClick={() => view(t)}>
                    {viewing === t ? <Loader2 className="size-3.5 animate-spin" /> : "View"}
                  </Button>
                  {canDelete ? (
                    <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => del.mutate({ id: technicianId, docType: t })}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              ) : canUpload ? (
                <UploadButton technicianId={technicianId} docType={t} />
              ) : (
                <span className="text-[11px] text-muted-foreground">Not uploaded</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Sensitive fields */}
      <div className="grid gap-3 sm:grid-cols-2">
        <SensitiveField label="SSN" value={sensitive?.ssn} masked={sensitive?.masked} />
        <SensitiveField label="Bank account" value={sensitive?.bankAccount} masked={sensitive?.masked} />
      </div>
      {isSelf && can("documents", "upload") ? (
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSensitiveOpen(true)}>
          Update SSN / bank
        </Button>
      ) : null}

      {/* Audit trail */}
      {audit && audit.length > 0 ? (
        <section>
          <Label className="mb-2 block text-[11px] tracking-wide uppercase">Access audit</Label>
          <div className="max-h-64 divide-y overflow-y-auto rounded-lg border text-sm">
            {audit.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>
                  <span className="font-medium">{auditLabel(r.action)}</span>
                  {r.resource ? <span className="text-muted-foreground"> · {r.resource}</span> : null}
                </span>
                <span className="text-xs whitespace-nowrap text-muted-foreground">
                  {auditActorLabel(r, userMap ?? new Map())} · {formatDate(r.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <SetSensitiveDialog technicianId={technicianId} open={sensitiveOpen} onOpenChange={setSensitiveOpen} />
    </div>
  );
}

function SensitiveField({ label, value, masked }: { label: string; value?: string | null; masked?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex h-10 items-center justify-between rounded-lg border bg-muted/40 px-3 font-mono text-sm">
        <span>{value ?? "—"}</span>
        {value && masked ? <span className="text-[11px] text-muted-foreground">last 4</span> : null}
      </div>
    </div>
  );
}

function UploadButton({ technicianId, docType }: { technicianId: string; docType: DocumentType }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadDocument();
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate({ id: technicianId, docType, file: f });
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

function SetSensitiveDialog({
  technicianId,
  open,
  onOpenChange,
}: {
  technicianId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const set = useSetSensitive();
  const form = useForm<SensitiveValues>({
    resolver: zodResolver(sensitiveSchema),
    defaultValues: { ssn: "", bankAccount: "" },
  });
  const onSubmit = (v: SensitiveValues) => {
    const body: { ssn?: string; bankAccount?: string } = {};
    if (v.ssn) body.ssn = v.ssn;
    if (v.bankAccount) body.bankAccount = v.bankAccount;
    if (!body.ssn && !body.bankAccount) return;
    set.mutate({ id: technicianId, body }, { onSuccess: () => { form.reset(); onOpenChange(false); } });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update sensitive data</DialogTitle>
          <DialogDescription>Stored encrypted. Leave a field blank to keep it unchanged.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label>SSN</Label>
            <Input className="h-10 font-mono" placeholder="123-45-6789" {...form.register("ssn")} />
            {form.formState.errors.ssn ? <p className="text-xs text-destructive">{form.formState.errors.ssn.message}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label>Bank account</Label>
            <Input className="h-10 font-mono" placeholder="000123456789" {...form.register("bankAccount")} />
            {form.formState.errors.bankAccount ? <p className="text-xs text-destructive">{form.formState.errors.bankAccount.message}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="brand" className="gap-1.5" disabled={set.isPending}>
              {set.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
