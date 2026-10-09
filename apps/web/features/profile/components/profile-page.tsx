"use client";

import { useState } from "react";
import type { User } from "@bitcrm/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { WzPageHeader } from "@/components/workiz/page-parts";
import { WzPopMenu, type WzPopMenuItem } from "@/components/workiz/pop-menu";
import { WzTabBar, type WzTab } from "@/components/workiz/tab-bar";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useMe } from "@/features/auth/use-me";
import { usePermissions } from "@/features/auth/use-permissions";
import { useLogout, useRequestReset } from "@/features/auth/hooks";
import { useJobTypesLoading } from "@/features/job-types/lib";
import { useSecuritySettings } from "@/features/security-center/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { useAssignments, useOnboarding, useProfile } from "@/features/technicians/hooks";
import { technicianEditRights } from "@/features/technicians/lib";
import { CommissionTab } from "@/features/technicians/components/commission-tab";
import { DocumentsTab } from "@/features/technicians/components/documents-tab";
import { TechnicianForm } from "@/features/technicians/components/technician-form";
import { AccountForm } from "./account-form";
import { SelfTwoFactor } from "./self-two-factor";

type ProfileTab = "profile" | "availability" | "commissions" | "documents";

/**
 * My Profile, as Workiz's user page (`/root/editUser/<id>`,
 * pg_technicians_wz_10_user_profile) — which is also where a Workiz user
 * finds their own settings (its avatar menu has no "My profile"):
 * "User Settings" with "Actions ⌄" at the right, the small tab row, and the
 * two-column form over the yellow Save bar.
 *
 * A technician gets the technician card's own form (`TechnicianForm`): their
 * contact details theirs to change, the rest a manager's and greyed, their
 * job types and service areas to propose, the onboarding checklist; and the
 * card's tabs — Profile, Availability, Commissions, ours Documents. Anyone
 * else gets their account on the same page (`AccountForm`). Two-factor
 * authentication is the self-service row either way — and reads "Required
 * by your account" when Settings → Security Center says so, which is why the
 * account's security row is part of the page's gate.
 *
 * Actions holds Workiz's "Reset password" (asked first: a code goes to the
 * email) and "Log Out" (Workiz keeps it in the avatar menu; ours is here too,
 * where the old page had Sign out).
 *
 * The heading stands from the first frame; one skeleton holds the tabs and
 * the columns until everything they show is in.
 */
export function ProfilePage() {
  const { data: me } = useMe();
  const { isTechnician, isLoading: permsLoading } = usePermissions();
  const security = useSecuritySettings();
  const signOut = useLogout();
  const requestReset = useRequestReset();
  const [confirmReset, setConfirmReset] = useState(false);

  const actions: WzPopMenuItem[] = [
    { key: "reset", label: "Reset password", onSelect: () => setConfirmReset(true), disabled: !me },
    { key: "logout", label: "Log Out", onSelect: signOut },
  ];
  const mfaRequired = security.data?.requireMfa === true;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="-mt-px">
        <WzPageHeader title="User Settings" end={<WzPopMenu items={actions} className="mr-3" />} />
      </div>

      {!me || permsLoading || !settled(security) ? (
        <ProfileSkeleton />
      ) : isTechnician ? (
        <TechnicianProfile me={me} mfaRequired={mfaRequired} />
      ) : (
        <AccountProfile me={me} mfaRequired={mfaRequired} />
      )}

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset your password?</AlertDialogTitle>
            <AlertDialogDescription>
              We&apos;ll email a code to <b>{me?.email}</b>. Enter it on the next screen to set a new password. You stay
              signed in here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => me && requestReset.mutate(me.email)}>Email me a code</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Workiz's small tab row under the heading (as the technician card's). */
function ProfileTabs({ tabs, value, onChange }: { tabs: WzTab[]; value: string; onChange: (v: ProfileTab) => void }) {
  return (
    <WzTabBar aria-label="My profile" className="-ml-px shrink-0" tabs={tabs} value={value} onValueChange={(v) => onChange(v as ProfileTab)} />
  );
}

/**
 * Anyone who is not a technician: their account on the user page. Workiz's
 * tab row (Profile · Availability · Advanced · Commissions) is the
 * technician card's; an account has nothing but Profile, and a strip with
 * one tab read as a broken tab row (app_audit #25), so none is drawn.
 */
function AccountProfile({ me, mfaRequired }: { me: User; mfaRequired: boolean }) {
  const { can, roleName } = usePermissions();
  return <AccountForm me={me} roleName={roleName} canEditUser={can("users", "edit")} mfaRequired={mfaRequired} />;
}

/**
 * A technician: the technician card's form and tabs for themselves, behind
 * the card's own gate — the profile, the assignments and the catalogs that
 * name them, the onboarding checklist.
 */
function TechnicianProfile({ me, mfaRequired }: { me: User; mfaRequired: boolean }) {
  const { can, isTechnician } = usePermissions();
  const [tab, setTab] = useState<ProfileTab>("profile");
  const profile = useProfile(me.id);
  const assignments = useAssignments(me.id);
  const onboarding = useOnboarding(me.id);
  const areas = useServiceAreas();
  const jobTypesLoading = useJobTypesLoading();
  const ready = usePageReady([profile, assignments, onboarding, areas].every(settled) && !jobTypesLoading);

  if (!ready) return <ProfileSkeleton />;

  const rights = technicianEditRights({
    canEdit: can("technicians", "edit"),
    isTechnician,
    canEditUser: can("users", "edit"),
  });
  const tabs: WzTab[] = [
    { value: "profile", label: "Profile" },
    { value: "availability", label: "Availability" },
    ...(can("commission", "view") ? [{ value: "commissions", label: "Commissions" }] : []),
    ...(can("documents", "view") ? [{ value: "documents", label: "Documents" }] : []),
  ];

  return (
    <>
      <ProfileTabs tabs={tabs} value={tab} onChange={setTab} />
      <div hidden={tab !== "profile" && tab !== "availability"} className="flex min-h-0 flex-1 flex-col">
        <TechnicianForm
          technicianId={me.id}
          user={me}
          rights={rights}
          tab={tab === "availability" ? "availability" : "profile"}
          twoFactor={<SelfTwoFactor me={me} required={mfaRequired} />}
        />
      </div>
      {tab === "commissions" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-9 pb-12 md:px-12">
          <CommissionTab technicianId={me.id} />
        </div>
      ) : null}
      {tab === "documents" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-9 pb-12 md:px-12">
          <DocumentsTab technicianId={me.id} />
        </div>
      ) : null}
    </>
  );
}

/** The page's one skeleton under the heading: the tab row and the two columns. */
function ProfileSkeleton() {
  return (
    <div className="flex flex-1 flex-col" aria-busy>
      <div className="mt-4 flex gap-10 border-b border-wz-tab-rule px-5 pb-2.5">
        <Skeleton className="h-5 w-14" />
        <Skeleton className="h-5 w-20" />
      </div>
      <div className="grid grid-cols-1 gap-x-11 gap-y-6 px-4 pt-9 md:grid-cols-[minmax(0,480px)_minmax(0,480px)] md:px-12">
        <Skeleton className="h-[28rem] w-full" />
        <Skeleton className="h-[28rem] w-full" />
      </div>
    </div>
  );
}
