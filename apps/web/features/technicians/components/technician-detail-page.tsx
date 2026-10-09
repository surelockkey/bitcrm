"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButton } from "@/components/workiz/button";
import { WzPageHeader } from "@/components/workiz/page-parts";
import { WzPopMenu, type WzPopMenuItem } from "@/components/workiz/pop-menu";
import { WzTabBar, type WzTab } from "@/components/workiz/tab-bar";
import { usePermissions } from "@/features/auth/use-permissions";
import { personName } from "@/features/deals/person-name";
import { useJobTypesLoading } from "@/features/job-types/lib";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useAssignments, useOnboarding, useProfile, useUserMap } from "../hooks";
import { techUser, technicianEditRights } from "../lib";
import { CommissionTab } from "./commission-tab";
import { DocumentsTab } from "./documents-tab";
import { TechnicianForm } from "./technician-form";
import { TechnicianTextDialog } from "./technician-text-dialog";

type CardTab = "profile" | "availability" | "commissions" | "documents";

/**
 * The technician card as Workiz's user page (`/root/editUser/<id>`,
 * pg_technicians_wz_10_user_profile): "User Settings" at the top with
 * "Actions ⌄" at the right, the small tab row — Profile, Availability,
 * Commissions — and the two-column form over Workiz's Save bar.
 *
 * Ours beside Workiz's: a Documents tab after Commissions (Workiz has none),
 * and in Actions the team chat with this person. Workiz's Advanced tab (sync
 * email, allowed IPs, notification switches, signature) and its Actions
 * "Reset password" / "Disable user" have nothing behind them here and are
 * left out; the account's own life is the Users page's.
 *
 * No way back in the header: the sidebar is the way back (the owner struck the
 * button that duplicated it), and Workiz has none either.
 */
export function TechnicianDetailPage({ technicianId }: { technicianId: string }) {
  const router = useRouter();
  const { can, me, isTechnician, isLoading: permsLoading } = usePermissions();
  const [tab, setTab] = useState<CardTab>("profile");
  const [texting, setTexting] = useState(false);

  const query = useProfile(technicianId);
  const userMapQuery = useUserMap();
  const userMap = userMapQuery.data;
  // What the Profile tab shows besides the profile, asked for with it: the
  // assignments and the catalogs that name them, and the onboarding
  // checklist. Each used to land on its own and push down every block under it.
  const assignments = useAssignments(technicianId);
  const onboarding = useOnboarding(technicianId);
  const areas = useServiceAreas();
  const jobTypesLoading = useJobTypesLoading();
  const ready = usePageReady(
    !permsLoading && [query, userMapQuery, assignments, onboarding, areas].every(settled) && !jobTypesLoading,
  );

  const rights = technicianEditRights({
    canEdit: can("technicians", "edit"),
    isTechnician,
    // The name, the field-team switch and two-step sign-in are the user record's.
    canEditUser: can("users", "edit"),
  });

  if (!permsLoading && !can("technicians", "view")) {
    return <Center title="No access" body="You don't have permission to view technicians." />;
  }
  if (!ready) return <DetailSkeleton />;
  if (query.isError || !query.data) {
    return (
      <Center
        title="No technician profile"
        body="This user isn't a technician, or the profile hasn't been provisioned yet."
        action={
          <WzButton variant="secondary" size="regular" onClick={() => router.push("/technicians")}>
            Back to technicians
          </WzButton>
        }
      />
    );
  }

  // `me` fallback: a technician viewing their own page has no users.view,
  // so the map is empty — but their own record is already in the session.
  const map = userMap ?? new Map<string, User>();
  const u = techUser(technicianId, map, me);
  const name = personName(u) ?? "this technician";

  const tabs: WzTab[] = [
    { value: "profile", label: "Profile" },
    { value: "availability", label: "Availability" },
    ...(can("commission", "view") ? [{ value: "commissions", label: "Commissions" }] : []),
    ...(can("documents", "view") ? [{ value: "documents", label: "Documents" }] : []),
  ];

  const actions: WzPopMenuItem[] = [];
  if (me?.id !== technicianId && can("messages", "send")) {
    actions.push({ key: "text", label: "Send a text", onSelect: () => setTexting(true) });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* "User Settings" (25px/32px 500 ink, 24px in) with Actions at the right:
          a 40px row whose top sits 14px under the breadcrumb, the h2 centred in it. */}
      <div className="-mt-px">
        <WzPageHeader title="User Settings" end={actions.length ? <WzPopMenu items={actions} className="mr-3" /> : null} />
      </div>
      <WzTabBar
        aria-label="Technician"
        className="-ml-px shrink-0"
        tabs={tabs}
        value={tab}
        onValueChange={(v) => setTab(v as CardTab)}
      />

      {/* Profile and Availability are one form with one Save, as on Workiz's
          page; the other two tabs carry their own controls, so the form and
          its bar step aside while they are open. */}
      <div hidden={tab !== "profile" && tab !== "availability"} className="flex min-h-0 flex-1 flex-col">
        <TechnicianForm
          technicianId={technicianId}
          user={u}
          rights={rights}
          tab={tab === "availability" ? "availability" : "profile"}
        />
      </div>

      {tab === "commissions" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-12 pt-9 pb-12">
          <CommissionTab technicianId={technicianId} />
        </div>
      ) : null}

      {tab === "documents" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-12 pt-9 pb-12">
          <DocumentsTab technicianId={technicianId} />
        </div>
      ) : null}

      <TechnicianTextDialog technicianId={technicianId} name={name} open={texting} onOpenChange={setTexting} />
    </div>
  );
}

function Center({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-sm text-wz-outline-label">{body}</p>
      {action}
    </div>
  );
}

/** The page's one skeleton: the header, the tab row and the two columns. */
function DetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="px-6 pt-7">
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="mt-4 flex gap-10 border-b border-wz-tab-rule px-5 pb-2.5">
        <Skeleton className="h-5 w-14" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="grid grid-cols-[minmax(0,480px)_minmax(0,480px)] gap-x-11 px-12 pt-9">
        <Skeleton className="h-[28rem] w-full" />
        <Skeleton className="h-[28rem] w-full" />
      </div>
    </div>
  );
}
