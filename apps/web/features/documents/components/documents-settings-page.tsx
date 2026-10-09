"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText } from "lucide-react";
import { WzSettingsHeader } from "@/components/workiz/settings-page";
import { WzTabBar } from "@/components/workiz/tab-bar";
import { usePermissions } from "@/features/auth/use-permissions";
import { DocumentDefaultsTab } from "./document-defaults-tab";
import { DocumentMessagesTab } from "./document-messages-tab";
import { TemplatesTab } from "./templates-tab";

const TABS = ["templates", "defaults", "messages"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = { templates: "Templates", defaults: "Defaults", messages: "Messages" };

/**
 * Settings → Documents, as Workiz's Document templates page
 * (pg_settings_general_wz_documents): the settings band, then — ours, under
 * Workiz's small tabs — the templates grid, the defaults every new document
 * starts with, and the messages the Send panel starts from (Workiz keeps
 * those in each template's "Document settings"). Company details live in
 * Settings → Companies; the band says so where Workiz has its guide links.
 */
export function DocumentsSettingsPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const canEditTemplates = can("document_templates", "edit");
  const canEditSettings = can("settings", "edit");
  const raw = search.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "templates";

  // Refuse only once the permissions are known — not for the beat they are
  // still on the way.
  if (!permsLoading && !can("document_templates", "view")) {
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
    <div className="flex min-w-0 flex-1 flex-col">
      <WzSettingsHeader
        icon={<FileText />}
        title="Document templates"
        description={
          <>
            <p>Customize the appearance of your invoices and estimates.</p>
            {/* #3da6e1: the band's link blue (Workiz's "Read guide"). */}
            <p className="mt-2 leading-4">
              Names, logos and addresses come from the job&apos;s company:{" "}
              <Link href="/settings/companies" className="text-[#3da6e1] hover:underline">
                Settings → Companies
              </Link>
            </p>
          </>
        }
      />
      <WzTabBar
        aria-label="Documents"
        className="mx-5 mt-5"
        tabs={TABS.map((t) => ({ value: t, label: TAB_LABELS[t] }))}
        value={tab}
        onValueChange={setTab}
      />
      {/* Each tab waits for the permissions too: what it may offer — "Add New
          Template", Save — comes with the rest, not a beat after it. */}
      <div role="tabpanel" aria-label={TAB_LABELS[tab]} className="flex min-w-0 flex-1 flex-col">
        {tab === "templates" ? (
          <TemplatesTab canEdit={canEditTemplates} permsLoading={permsLoading} />
        ) : tab === "defaults" ? (
          <DocumentDefaultsTab canEdit={canEditSettings} permsLoading={permsLoading} />
        ) : (
          <DocumentMessagesTab canEdit={canEditSettings} permsLoading={permsLoading} />
        )}
      </div>
    </div>
  );
}
