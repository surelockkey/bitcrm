"use client";

import Link from "next/link";
import { Building, ChevronRight } from "lucide-react";
import { usePermissions } from "@/features/auth/use-permissions";
import { TemplatesTab } from "./templates-tab";

/** Settings → Documents: PDF templates. Company details live in Settings → Companies. */
export function DocumentsSettingsPage() {
  const { can } = usePermissions();
  const canEdit = can("document_templates", "edit");

  if (!can("document_templates", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view document templates.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Documents</h2>
        <p className="text-sm text-muted-foreground">Design your invoice, estimate and custom PDFs.</p>
      </div>
      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
        <Building className="size-5 flex-none text-muted-foreground" />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          Names, logos, addresses and invoice defaults printed on documents come from the job&apos;s company.
        </p>
        <Link
          href="/settings/companies"
          className="inline-flex flex-none items-center gap-0.5 text-sm font-medium text-foreground hover:underline"
        >
          Settings → Companies <ChevronRight className="size-4" />
        </Link>
      </div>
      <TemplatesTab canEdit={canEdit} />
    </div>
  );
}
