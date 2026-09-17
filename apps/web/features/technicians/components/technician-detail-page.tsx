"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@bitcrm/types";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { initials, roleName } from "@/features/users/lib";
import { usePermissions } from "@/features/auth/use-permissions";
import { useRoles } from "@/features/roles/hooks";
import { TextButton } from "@/features/messaging/components/text-button";
import { WorkingHoursEditor } from "@/features/schedule/components/working-hours-editor";
import { useProfile, useUserMap } from "../hooks";
import { techName, techUser, technicianEditRights } from "../lib";
import {
  AVAILABILITY_NOT_CONNECTED,
  NOT_CONNECTED_BANNER,
  SETTINGS_NOT_CONNECTED,
} from "../not-connected";
import { TechnicianStatusBadge } from "./technician-status-badge";
import { TechnicianForm } from "./technician-form";
import { NotConnectedField } from "./not-connected-field";
import { OnboardingSection } from "./onboarding-section";
import { CommissionTab } from "./commission-tab";
import { DocumentsTab } from "./documents-tab";

/**
 * The technician card, in the shape of the Workiz user page it replaces: one
 * form in two columns, then the blocks that carry their own Save.
 *
 * There are no tabs. Profile and Assignments were two halves of one form, and
 * the three that remained — Overview, Commission, Documents — were not worth a
 * tab strip over a page you scroll. What each block costs to read is now
 * visible at once, which is how the owner's people use the Workiz page.
 *
 * Order below the columns: availability (theirs, where they put it), then our
 * onboarding, commission and documents, and last the settings we hold no data
 * for. Workiz lists those four higher up; putting dead controls above three
 * working features would be parity of layout at the price of the page.
 */
export function TechnicianDetailPage({ technicianId }: { technicianId: string }) {
  const router = useRouter();
  const { can, me, isTechnician } = usePermissions();
  const query = useProfile(technicianId);
  const { data: userMap } = useUserMap();
  // Only to name the role in the work column; technicians hold no `roles.view`.
  const { data: roles } = useRoles(can("roles", "view"));

  const rights = technicianEditRights({
    canEdit: can("technicians", "edit"),
    isTechnician,
  });

  if (!can("technicians", "view")) {
    return <Center title="No access" body="You don't have permission to view technicians." />;
  }
  if (query.isLoading) return <DetailSkeleton />;
  if (query.isError || !query.data) {
    return (
      <Center
        title="No technician profile"
        body="This user isn't a technician, or the profile hasn't been provisioned yet."
        action={
          <Button variant="outline" onClick={() => router.push("/technicians")}>
            Back to technicians
          </Button>
        }
      />
    );
  }

  const profile = query.data;
  // `me` fallback: a technician viewing their own page has no users.view,
  // so the map is empty — but their own name is already in the session.
  const map = userMap ?? new Map<string, User>();
  const u = techUser(technicianId, map, me);
  const name = techName(technicianId, map, me);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => router.push("/technicians")}>
          <ArrowLeft className="size-4" />
          Technicians
        </Button>
        <Avatar className="size-8">
          {profile.profilePhotoUrl ? <AvatarImage src={profile.profilePhotoUrl} alt="" /> : null}
          <AvatarFallback className="text-xs">{initials(u?.firstName, u?.lastName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">{name}</h1>
          {u?.email ? <div className="truncate text-xs text-muted-foreground">{u.email}</div> : null}
        </div>
        {me?.id !== technicianId ? (
          <TextButton partyKind="user" partyId={technicianId} name={name} />
        ) : null}
        <TechnicianStatusBadge status={profile.status} />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-8 px-6 py-6">
          <TechnicianForm
            technicianId={technicianId}
            user={u}
            roleLabel={u ? roleName(u.roleId, roles) : "—"}
            rights={rights}
          />

          <Block title="User availability">
            <NotConnectedField field={AVAILABILITY_NOT_CONNECTED} />
            {/* Its own Save, as on their page — and as it already had here. */}
            <WorkingHoursEditor profile={profile} readOnly={!rights.operational} />
          </Block>

          <OnboardingSection technicianId={technicianId} />

          {can("commission", "view") ? (
            <Block title="Commission">
              {/* Laid out in the new page, wired exactly as it was. */}
              <CommissionTab technicianId={technicianId} />
            </Block>
          ) : null}

          {can("documents", "view") ? (
            <Block title="Documents">
              <DocumentsTab technicianId={technicianId} />
            </Block>
          ) : null}

          <Block title="Workiz settings we don't hold yet">
            <p className="text-sm text-muted-foreground">{NOT_CONNECTED_BANNER}</p>
            <div className="space-y-5">
              {SETTINGS_NOT_CONNECTED.map((field) => (
                <NotConnectedField key={field.key} field={field} />
              ))}
            </div>
          </Block>
        </div>
      </div>
    </div>
  );
}

/** A full-width block below the two columns, each with its own heading. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Center({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="mx-auto grid w-full max-w-5xl gap-x-10 gap-y-6 p-6 md:grid-cols-2">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  );
}
