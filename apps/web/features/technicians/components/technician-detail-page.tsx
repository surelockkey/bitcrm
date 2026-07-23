"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { initials } from "@/features/users/lib";
import { usePermissions } from "@/features/auth/use-permissions";
import { useProfile, useUserMap } from "../hooks";
import { techName, techUser } from "../lib";
import { TechnicianStatusBadge } from "./technician-status-badge";
import { OverviewTab } from "./overview-tab";
import { ProfileTab } from "./profile-tab";
import { SkillsTab } from "./skills-tab";
import { CommissionTab } from "./commission-tab";
import { DocumentsTab } from "./documents-tab";

export function TechnicianDetailPage({ technicianId }: { technicianId: string }) {
  const router = useRouter();
  const { can, me } = usePermissions();
  const query = useProfile(technicianId);
  const { data: userMap } = useUserMap();
  const [tab, setTab] = useState("overview");

  const canEditTech = can("technicians", "edit");

  const tabs = [
    { value: "overview", label: "Overview", node: <OverviewTab technicianId={technicianId} /> },
    { value: "profile", label: "Profile", node: <ProfileTab technicianId={technicianId} readOnly={!canEditTech} /> },
    ...(can("skills", "view") ? [{ value: "skills", label: "Skills", node: <SkillsTab technicianId={technicianId} /> }] : []),
    ...(can("commission", "view") ? [{ value: "commission", label: "Commission", node: <CommissionTab technicianId={technicianId} /> }] : []),
    ...(can("documents", "view") ? [{ value: "documents", label: "Documents", node: <DocumentsTab technicianId={technicianId} /> }] : []),
  ];

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
  const u = techUser(technicianId, userMap ?? new Map(), me);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => router.push("/technicians")}>
          <ArrowLeft className="size-4" />
          Technicians
        </Button>
        <Avatar className="size-8">
          <AvatarFallback className="text-xs">{initials(u?.firstName, u?.lastName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {techName(technicianId, userMap ?? new Map(), me)}
          </h1>
          {u?.email ? <div className="truncate text-xs text-muted-foreground">{u.email}</div> : null}
        </div>
        <TechnicianStatusBadge status={profile.status} />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col">
        <div className="border-b px-6">
          <div className="mx-auto max-w-4xl">
            <TabsList variant="line" className="h-11">
              {tabs.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="px-2">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-6 py-6">
            {tabs.map((t) => (
              <TabsContent key={t.value} value={t.value} className="mt-0">
                {t.node}
              </TabsContent>
            ))}
          </div>
        </div>
      </Tabs>
    </div>
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
      <div className="mx-auto w-full max-w-4xl p-6">
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
