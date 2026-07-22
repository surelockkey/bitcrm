"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, LogOut, Pencil } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserStatus } from "@bitcrm/types";
import type { User } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { useMe } from "@/features/auth/use-me";
import { usePermissions } from "@/features/auth/use-permissions";
import { useLogout, useRequestReset } from "@/features/auth/hooks";
import { initials, formatDate } from "@/features/users/lib";
import { useUpdateUser } from "@/features/users/hooks";
import { updateUserSchema, type UpdateUserValues } from "@/features/users/schemas";
import { useOnboarding } from "@/features/technicians/hooks";
import { onboardingPct } from "@/features/technicians/lib";
import { AssignmentsTab } from "@/features/technicians/components/assignments-tab";
import { DocumentsTab } from "@/features/technicians/components/documents-tab";
import { CommissionTab } from "@/features/technicians/components/commission-tab";
import { SelfProfileForm } from "./self-profile-form";

export function ProfilePage() {
  const { data: me, isLoading } = useMe();
  const { can, isTechnician, roleName } = usePermissions();

  if (isLoading || !me) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 p-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">My Profile</h1>
        <p className="text-sm text-muted-foreground">Your account, security, and onboarding.</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
          <AccountCard me={me} roleName={roleName} canEdit={can("users", "edit")} />
          <SecurityCard email={me.email} />
          {isTechnician ? <TechnicianSelfService technicianId={me.id} /> : null}
        </div>
      </div>
    </div>
  );
}

function AccountCard({
  me,
  roleName,
  canEdit,
}: {
  me: User;
  roleName: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateUser();
  const form = useForm<UpdateUserValues>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { firstName: me.firstName, lastName: me.lastName, department: me.department },
  });

  const save = (v: UpdateUserValues) =>
    update.mutate({ id: me.id, body: v }, { onSuccess: () => setEditing(false) });

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center gap-4 p-5">
        <Avatar className="size-14">
          <AvatarFallback className="text-lg">{initials(me.firstName, me.lastName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold">{me.firstName} {me.lastName}</div>
          <div className="truncate text-sm text-muted-foreground">{me.email}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="font-normal">{roleName}</Badge>
            {me.department ? <Badge variant="outline" className="font-normal">{me.department}</Badge> : null}
            <Badge variant="outline" className="gap-1.5 font-normal">
              <span className={cn("size-1.5 rounded-full", me.status === UserStatus.ACTIVE ? "bg-green-500" : "bg-muted-foreground/50")} />
              {me.status === UserStatus.ACTIVE ? "Active" : "Inactive"}
            </Badge>
          </div>
        </div>
        {canEdit && !editing ? (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        ) : null}
      </div>

      <div className="border-t px-5 py-4">
        {editing ? (
          <form onSubmit={form.handleSubmit(save)} className="space-y-3" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" error={form.formState.errors.firstName?.message}>
                <Input className="h-10" {...form.register("firstName")} />
              </Field>
              <Field label="Last name" error={form.formState.errors.lastName?.message}>
                <Input className="h-10" {...form.register("lastName")} />
              </Field>
            </div>
            <Field label="Department" error={form.formState.errors.department?.message}>
              <Input className="h-10" {...form.register("department")} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              <Button type="submit" variant="brand" size="sm" className="gap-1.5" disabled={update.isPending}>
                {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Save
              </Button>
            </div>
          </form>
        ) : (
          <>
            <dl className="text-sm">
              <Row label="Email" value={<span>{me.email} <span className="ml-1 rounded-full border px-1.5 text-[10px] text-muted-foreground">login</span></span>} />
              <Row label="Department" value={me.department || "—"} />
              <Row label="Role" value={roleName} />
              <Row label="Member since" value={formatDate(me.createdAt)} last />
            </dl>
            {!canEdit ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Your name and department are managed by an admin. Email can&apos;t be changed.
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function SecurityCard({ email }: { email: string }) {
  const signOut = useLogout();
  const requestReset = useRequestReset();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-sm font-semibold">Security</h3>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-medium">Password</div>
          <p className="text-xs text-muted-foreground">We&apos;ll email you a code to set a new one.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setConfirmReset(true)}>
          <KeyRound className="size-3.5" /> Reset password
        </Button>
      </div>
      <div className="mt-3 flex items-center justify-between border-t pt-3">
        <div>
          <div className="text-sm font-medium">Sign out</div>
          <p className="text-xs text-muted-foreground">End your session on this device.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={signOut}>
          <LogOut className="size-3.5" /> Sign out
        </Button>
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset your password?</AlertDialogTitle>
            <AlertDialogDescription>
              We&apos;ll email a code to <b>{email}</b>. Enter it on the next screen to
              set a new password. You stay signed in here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => requestReset.mutate(email)}>Email me a code</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function TechnicianSelfService({ technicianId }: { technicianId: string }) {
  const { data: onboarding } = useOnboarding(technicianId);
  const [tab, setTab] = useState("profile");

  const pct = onboarding ? onboardingPct(onboarding) : 0;
  const nextStep = onboarding
    ? !onboarding.checklist.profileComplete
      ? "complete your profile"
      : !onboarding.checklist.assignmentsApproved
        ? "get your job types & areas approved"
        : !onboarding.checklist.commissionSet
          ? "your commission needs setting"
          : null
    : null;

  return (
    <section className="rounded-xl border bg-card">
      {onboarding && pct < 100 ? (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-5 py-3 text-sm text-amber-700 dark:text-amber-500">
          <span className="font-medium">
            Onboarding · {onboarding.completedSteps} of {onboarding.totalSteps}
          </span>
          {nextStep ? <span>— next: {nextStep}</span> : null}
          <span className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-amber-500/20">
            <span className="block h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
          </span>
        </div>
      ) : (
        <div className="border-b px-5 py-3 text-sm font-medium">Technician</div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="flex flex-col">
        <div className="border-b px-5">
          <TabsList variant="line" className="h-11">
            <TabsTrigger value="profile" className="px-2">Profile</TabsTrigger>
            <TabsTrigger value="assignments" className="px-2">Assignments</TabsTrigger>
            <TabsTrigger value="documents" className="px-2">Documents</TabsTrigger>
            <TabsTrigger value="commission" className="px-2">Commission</TabsTrigger>
          </TabsList>
        </div>
        <div className="p-5">
          <TabsContent value="profile" className="mt-0"><SelfProfileForm technicianId={technicianId} /></TabsContent>
          <TabsContent value="assignments" className="mt-0"><AssignmentsTab technicianId={technicianId} /></TabsContent>
          <TabsContent value="documents" className="mt-0"><DocumentsTab technicianId={technicianId} /></TabsContent>
          <TabsContent value="commission" className="mt-0"><CommissionTab technicianId={technicianId} /></TabsContent>
        </div>
      </Tabs>
    </section>
  );
}

function Row({ label, value, last }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-2", !last && "border-b")}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
