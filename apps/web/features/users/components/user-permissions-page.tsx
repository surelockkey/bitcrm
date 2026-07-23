"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Eraser,
  Info,
  Loader2,
  Lock,
  TriangleAlert,
} from "lucide-react";
import { DataScope } from "@bitcrm/types";
import type { ResolvedPermissions, Role, User } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { usePermissions } from "@/features/auth/use-permissions";
import { useRole, useRoleSchema } from "@/features/roles/hooks";
import { diffCells, isSuperAdmin, normalizeMatrix, type Schema } from "@/features/roles/lib";
import { PermissionMatrixEditor } from "@/features/roles/components/permission-matrix";
import { DataScopeEditor } from "@/features/roles/components/data-scope-editor";
import { StageTransitionsEditor } from "@/features/roles/components/stage-transitions-editor";
import {
  useClearUserPermissions,
  useSetUserPermissions,
  useUser,
  useUserPermissions,
} from "../hooks";
import { useHierarchy } from "../use-can-manage";
import {
  buildOverrides,
  normalizeScopes,
  overrideSummary,
  type OverridesDraft,
} from "../overrides";

/** Loader + access gate for `/admin/users/[id]/permissions`. */
export function UserPermissionsPage({ userId }: { userId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  const userQuery = useUser(userId);

  if (!can("users", "view")) {
    return <CenterMessage title="No access" body="You don't have permission to view users." />;
  }
  if (userQuery.isLoading) return <EditorSkeleton />;
  if (userQuery.isError || !userQuery.data) {
    return (
      <CenterMessage
        title="User not found"
        body="They may have been removed."
        action={
          <Button variant="outline" onClick={() => router.push("/admin/users")}>
            Back to users
          </Button>
        }
      />
    );
  }
  return <UserPermissionsLoader user={userQuery.data} />;
}

/** Second stage: needs the user before it can fetch their role + resolved set. */
function UserPermissionsLoader({ user }: { user: User }) {
  const router = useRouter();
  const resolvedQuery = useUserPermissions(user.id);
  const roleQuery = useRole(user.roleId);
  const { data: schema } = useRoleSchema();

  if (resolvedQuery.isLoading || roleQuery.isLoading || !schema) return <EditorSkeleton />;
  if (roleQuery.isError || !roleQuery.data) {
    return (
      <CenterMessage
        title="Role details unavailable"
        body="Editing overrides requires view access to this user's role."
        action={
          <Button variant="outline" onClick={() => router.push("/admin/users")}>
            Back to users
          </Button>
        }
      />
    );
  }
  if (resolvedQuery.isError || !resolvedQuery.data) {
    return (
      <CenterMessage title="Couldn't load permissions" body="Try again in a moment." />
    );
  }

  const role = roleQuery.data;
  return (
    <OverridesEditor
      // Remount on any upstream change so the draft cleanly re-seeds.
      key={`${user.id}:${user.updatedAt}:${role.updatedAt}:${resolvedQuery.dataUpdatedAt}`}
      user={user}
      role={role}
      resolved={resolvedQuery.data}
      schema={schema}
    />
  );
}

function toDraft(user: User, resolved: ResolvedPermissions, schema: Schema): OverridesDraft {
  return {
    permissions: normalizeMatrix(resolved.permissions, schema),
    dataScope: normalizeScopes(resolved.dataScope, schema),
    // The resolved payload can't distinguish "inherited" from an override that
    // happens to match the role — the sparse object on the user record can.
    transitionsOverridden: user.permissionOverrides?.dealStageTransitions !== undefined,
    dealStageTransitions: [...resolved.dealStageTransitions],
  };
}

function draftsEqual(a: OverridesDraft, b: OverridesDraft, schema: Schema): boolean {
  if (a.transitionsOverridden !== b.transitionsOverridden) return false;
  if (diffCells(a.permissions, b.permissions, schema) > 0) return false;
  for (const resource of Object.keys(schema)) {
    if (
      (a.dataScope[resource] ?? DataScope.ALL) !== (b.dataScope[resource] ?? DataScope.ALL)
    ) {
      return false;
    }
  }
  if (a.transitionsOverridden) {
    const sa = new Set(a.dealStageTransitions);
    const sb = new Set(b.dealStageTransitions);
    if (sa.size !== sb.size || [...sa].some((x) => !sb.has(x))) return false;
  }
  return true;
}

function OverridesEditor({
  user,
  role,
  resolved,
  schema,
}: {
  user: User;
  role: Role;
  resolved: ResolvedPermissions;
  schema: Schema;
}) {
  const router = useRouter();
  const { can } = usePermissions();
  const { canManage, isSelf } = useHierarchy();
  const setPermissions = useSetUserPermissions();
  const clearPermissions = useClearUserPermissions();

  const [initial] = useState(() => toDraft(user, resolved, schema));
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState("permissions");
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const readOnly = !(can("users", "edit") && canManage(user));
  const dirty = !draftsEqual(draft, initial, schema);
  const pending = setPermissions.isPending || clearPermissions.isPending;

  const basePermissions = normalizeMatrix(role.permissions, schema);
  const baseScopes = normalizeScopes(role.dataScope, schema);
  const sparse = buildOverrides(draft, role, schema);
  const saved = overrideSummary(user.permissionOverrides);

  const cellValues = Object.values(sparse?.permissions ?? {}).flatMap((row) =>
    Object.values(row),
  );
  const granted = cellValues.filter(Boolean).length;
  const revoked = cellValues.length - granted;
  const scopeChanges = Object.keys(sparse?.dataScope ?? {}).length;

  // Warn on browser close/refresh with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const goBack = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    router.push("/admin/users");
  };

  const save = () => {
    setConfirmSave(false);
    if (sparse === null) clearPermissions.mutate(user.id);
    else setPermissions.mutate({ id: user.id, body: sparse });
  };

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={goBack}>
          <ArrowLeft className="size-4" />
          Users
        </Button>
        <h1 className="truncate text-lg font-semibold tracking-tight">
          {user.firstName} {user.lastName}
        </h1>
        <Badge variant="secondary">{role.name}</Badge>
        {saved.any ? <Badge variant="outline">Custom permissions</Badge> : null}
        {!readOnly && saved.any ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1.5 text-muted-foreground"
            onClick={() => setConfirmReset(true)}
          >
            <Eraser className="size-3.5" />
            Reset to role defaults
          </Button>
        ) : null}
      </div>

      <OverridesAccessBanner
        user={user}
        role={role}
        readOnly={readOnly}
        canEditUsers={can("users", "edit")}
        isSelf={isSelf(user)}
      />

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col">
        <div className="border-b px-6">
          <TabsList variant="line" className="h-11">
            <TabsTrigger value="permissions" className="px-2">Permissions</TabsTrigger>
            <TabsTrigger value="scope" className="px-2">Data scope</TabsTrigger>
            <TabsTrigger value="stages" className="px-2">Deal stages</TabsTrigger>
          </TabsList>
        </div>

        {!readOnly && dirty ? (
          <div className="flex items-center gap-3 border-y border-amber-500/30 bg-amber-500/10 px-6 py-2 text-sm text-amber-700 dark:text-amber-500">
            <TriangleAlert className="size-4 flex-none" />
            <span>
              Unsaved changes · applies immediately to <b>{user.firstName}</b>
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDraft(initial)}>
                Discard
              </Button>
              <Button
                variant="brand"
                size="sm"
                className="gap-1.5"
                disabled={pending}
                onClick={() => setConfirmSave(true)}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Save changes
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <TabsContent value="permissions" className="mt-0">
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {cellValues.length === 0
                  ? "No cells overridden — matches the role."
                  : `${cellValues.length} ${cellValues.length === 1 ? "cell" : "cells"} overridden (${granted} granted, ${revoked} revoked)`}
              </span>
            </div>
            <div className="rounded-lg border">
              <PermissionMatrixEditor
                schema={schema}
                permissions={draft.permissions}
                baseline={basePermissions}
                readOnly={readOnly}
                onChange={(permissions) => setDraft((d) => ({ ...d, permissions }))}
              />
            </div>
          </TabsContent>

          <TabsContent value="scope" className="mt-0">
            <DataScopeEditor
              schema={schema}
              dataScope={draft.dataScope}
              baseline={baseScopes}
              readOnly={readOnly}
              onChange={(dataScope) => setDraft((d) => ({ ...d, dataScope }))}
            />
          </TabsContent>

          <TabsContent value="stages" className="mt-0">
            <div className="mb-4 flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
              <Switch
                checked={draft.transitionsOverridden}
                disabled={readOnly}
                onCheckedChange={(on) =>
                  setDraft((d) => ({
                    ...d,
                    transitionsOverridden: on,
                    dealStageTransitions: on
                      ? d.dealStageTransitions
                      : [...role.dealStageTransitions],
                  }))
                }
              />
              <div className="text-sm">
                <div className="font-medium">Override the role&apos;s stage transitions</div>
                <div className="text-xs text-muted-foreground">
                  {draft.transitionsOverridden
                    ? "This list fully replaces the role's transitions for this user."
                    : `Inherited from “${role.name}”.`}
                </div>
              </div>
            </div>
            <StageTransitionsEditor
              transitions={draft.dealStageTransitions}
              readOnly={readOnly || !draft.transitionsOverridden}
              onChange={(dealStageTransitions) =>
                setDraft((d) => ({ ...d, dealStageTransitions }))
              }
            />
          </TabsContent>
        </div>
      </Tabs>

      {/* Confirm: save */}
      <AlertDialog open={confirmSave} onOpenChange={setConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {sparse === null
                ? "Remove all custom permissions?"
                : `Save custom permissions for ${user.firstName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {sparse === null ? (
                <>
                  Everything now matches the <b>{role.name}</b> role, so the
                  stored overrides will be removed.
                </>
              ) : (
                <>
                  {cellValues.length > 0
                    ? `${cellValues.length} permission ${cellValues.length === 1 ? "change" : "changes"} (${granted} granted, ${revoked} revoked)`
                    : "No permission changes"}
                  {scopeChanges > 0
                    ? `, ${scopeChanges} data scope ${scopeChanges === 1 ? "change" : "changes"}`
                    : ""}
                  {sparse.dealStageTransitions !== undefined
                    ? ", custom stage transitions"
                    : ""}
                  . They apply on top of the <b>{role.name}</b> role and take
                  effect immediately.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={save}>Save changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm: reset to role defaults */}
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove all custom permissions for {user.firstName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They revert to the <b>{role.name}</b> role&apos;s defaults immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmReset(false);
                clearPermissions.mutate(user.id);
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function OverridesAccessBanner({
  user,
  role,
  readOnly,
  canEditUsers,
  isSelf,
}: {
  user: User;
  role: Role;
  readOnly: boolean;
  canEditUsers: boolean;
  isSelf: boolean;
}) {
  let node: { icon: ReactNode; text: string; tone: "info" | "warn" } | null = null;

  if (readOnly) {
    if (isSelf) {
      node = {
        icon: <Lock className="size-4" />,
        text: "You can't change your own permission overrides.",
        tone: "warn",
      };
    } else if (isSuperAdmin(role)) {
      node = {
        icon: <Lock className="size-4" />,
        text: "Super Admin permissions can't be overridden.",
        tone: "warn",
      };
    } else if (canEditUsers) {
      node = {
        icon: <Lock className="size-4" />,
        text: "This user's role ranks at or above yours, so this is read-only.",
        tone: "warn",
      };
    } else {
      node = {
        icon: <Info className="size-4" />,
        text: "You have view-only access to users.",
        tone: "info",
      };
    }
  } else {
    node = {
      icon: <Info className="size-4" />,
      text: `Changes apply on top of the “${role.name}” role for ${user.firstName} only. Assigning a different role clears all overrides.`,
      tone: "info",
    };
  }

  return (
    <div
      className={
        node.tone === "warn"
          ? "flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-sm text-amber-700 dark:text-amber-500"
          : "flex items-center gap-2 border-b bg-muted/40 px-6 py-2 text-sm text-muted-foreground"
      }
    >
      {node.icon}
      {node.text}
    </div>
  );
}

function CenterMessage({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
