"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building, ChevronRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/features/auth/use-permissions";
import { DocumentDefaultsTab } from "./document-defaults-tab";
import { DocumentMessagesTab } from "./document-messages-tab";
import { TemplatesTab } from "./templates-tab";

const TABS = ["templates", "defaults", "messages"] as const;
type Tab = (typeof TABS)[number];

/**
 * Settings → Documents: PDF templates, the defaults every new document starts
 * with, and the messages the Send panel starts from (Workiz Documents +
 * Email options). Company details live in Settings → Companies.
 */
export function DocumentsSettingsPage() {
  const { can } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const canEditTemplates = can("document_templates", "edit");
  const canEditSettings = can("settings", "edit");
  const raw = search.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "templates";

  if (!can("document_templates", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view document templates.</p>
      </div>
    );
  }

  const setTab = (next: string) => {
    const q = new URLSearchParams(search.toString());
    if (next === "templates") q.delete("tab");
    else q.set("tab", next);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Documents</h2>
        <p className="text-sm text-muted-foreground">
          Design your invoice, estimate and custom PDFs, and set what every new document starts with.
        </p>
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
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="defaults">Defaults</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
        </TabsList>
        <TabsContent value="templates" className="pt-4">
          <TemplatesTab canEdit={canEditTemplates} />
        </TabsContent>
        <TabsContent value="defaults" className="pt-4">
          <DocumentDefaultsTab canEdit={canEditSettings} />
        </TabsContent>
        <TabsContent value="messages" className="pt-4">
          <DocumentMessagesTab canEdit={canEditSettings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
