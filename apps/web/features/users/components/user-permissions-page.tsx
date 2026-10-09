"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Info, Lock } from "lucide-react";
import { DataScope } from "@bitcrm/types";
import type { ResolvedPermissions, Role, User } from "@bitcrm/types";
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
import { WzButton } from "@/components/workiz/button";
import { WzTabBar } from "@/components/workiz/tab-bar";
import { WzSwitchRow } from "@/components/workiz/switch-row";
import { WzSwitch } from "@/components/workiz/toggles";
import { WzWindowFrame } from "@/components/workiz/window-frame";
import { usePermissions } from "@/features/auth/use-permissions";
import { personName } from "@/features/deals/person-name";
import { useRole, useRoleSchema } from "@/features/roles/hooks";
import { diffCells, isSuperAdmin, normalizeMatrix, type Schema } from "@/features/roles/lib";
import { DataScopeEditor } from "@/features/roles/components/data-scope-editor";
import { EditorSkeleton, PermissionTab, RulesSection, RulesTab } from "@/features/roles/components/permission-tab";
import { StageTransitionsEditor } from "@/features/roles/components/stage-transitions-editor";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useClearUserPermissions, useRoles, useSetUserPermissions, useUser, useUserPermissions } from "../hooks";
import { useHierarchy } from "../use-can-manage";
import { buildOverrides, normalizeScopes, overrideSummary, type OverridesDraft } from "../overrides";

/** Back to the person — their sheet on the Users page. */
const userHref = (id: string) => `/admin/users?user=${id}`;

/**
 * Loader + access gate for `/admin/users/[id]/permissions`.
 *
 * Everything the editor shows is asked for at once — what needs only the id
 * with the user, their role the moment the user lands — and the page waits
 * for all of it behind one skeleton. It used to ask in three rounds, the last
 * (every role, for whether you outrank this user) only once it was on screen.
 */
export function UserPermissionsPage({ userId }: { userId: string }) {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const userQuery = useUser(userId);
  const resolvedQuery = useUserPermissions(userId);
  const schemaQuery = useRoleSchema();
  const rolesQuery = useRoles();
  const roleId = userQuery.data?.roleId ?? "";
  const roleQuery = useRole(roleId, !!roleId);
  const ready = usePageReady(
    !permsLoading && [userQuery, resolvedQuery, schemaQuery, rolesQuery, roleQuery].every(settled),
  );
  const close = () => router.push(userHref(userId));

  if (!permsLoading && !can("users", "view")) {
    return <CenterMessage title="No access" body="You don't have permission to view users." />;
  }
  if (!ready) return <EditorSkeleton onClose={close} />;
  if (userQuery.isError || !userQuery.data) {
    return (
      <CenterMessage
        title="User not found"
        body="They may have been removed."
        action={
          <WzButton variant="secondary" size="regular" onClick={() => router.push("/admin/users")}>
            Back to users
          </WzButton>
        }
      />
    );
  }
  return (
    <UserPermissionsLoader
      user={userQuery.data}
      resolvedQuery={resolvedQuery}
      roleQuery={roleQuery}
      schema={schemaQuery.data}
      onClose={close}
    />
  );
}

/** Second stage: the user's role and resolved set, already asked for above. */
function UserPermissionsLoader({
  user,
  resolvedQuery,
  roleQuery,
  schema,
  onClose,
}: {
  user: User;
  resolvedQuery: ReturnType<typeof useUserPermissions>;
  roleQuery: ReturnType<typeof useRole>;
  schema: Schema | undefined;
  onClose: () => void;
}) {
  const router = useRouter();

  if (!schema) return <EditorSkeleton onClose={onClose} />;
  if (roleQuery.isError || !roleQuery.data) {
    return (
      <CenterMessage
        title="Role details unavailable"
        body="Editing overrides requires view access to this user's role."
        action={
          <WzButton variant="secondary" size="regular" onClick={() => router.push("/admin/users")}>
            Back to users
          </WzButton>
        }
      />
    );
  }
  if (resolvedQuery.isError || !resolvedQuery.data) {
    return <CenterMessage title="Couldn't load permissions" body="Try again in a moment." />;
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
      onClose={onClose}
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
    if ((a.dataScope[resource] ?? DataScope.ALL) !== (b.dataScope[resource] ?? DataScope.ALL)) {
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

/**
 * One person's permissions over their role's — ours (Workiz keeps
 * permissions on the role only), drawn as Workiz's role window
 * (pg_admin_users_wz_10_role_dispatch): "Edit permissions for <name>", the
 * Actions / Reports / Advanced tabs, the switch rows, Cancel / Save. Every
 * switch shows the person's effective permission; a blue dot marks one that
 * differs from the role. Saving stores only the differences.
 */
function OverridesEditor({
  user,
  role,
  resolved,
  schema,
  onClose,
}: {
  user: User;
  role: Role;
  resolved: ResolvedPermissions;
  schema: Schema;
  onClose: () => void;
}) {
  const { can } = usePermissions();
  const { canManage, isSelf } = useHierarchy();
  const setPermissions = useSetUserPermissions();
  const clearPermissions = useClearUserPermissions();

  const [initial] = useState(() => toDraft(user, resolved, schema));
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState("actions");
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const readOnly = !(can("users", "edit") && canManage(user));
  const dirty = !draftsEqual(draft, initial, schema);
  const pending = setPermissions.isPending || clearPermissions.isPending;

  const basePermissions = normalizeMatrix(role.permissions, schema);
  const baseScopes = normalizeScopes(role.dataScope, schema);
  const sparse = buildOverrides(draft, role, schema);
  const saved = overrideSummary(user.permissionOverrides);

  const cellValues = Object.values(sparse?.permissions ?? {}).flatMap((row) => Object.values(row));
  const granted = cellValues.filter(Boolean).length;
  const revoked = cellValues.length - granted;
  const scopeChanges = Object.keys(sparse?.dataScope ?? {}).length;
  const name = personName(user) ?? user.email;

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

  const save = () => {
    setConfirmSave(false);
    if (sparse === null) clearPermissions.mutate(user.id);
    else setPermissions.mutate({ id: user.id, body: sparse });
  };

  const summary =
    cellValues.length === 0
      ? "No switch overridden — matches the role."
      : `${cellValues.length} ${cellValues.length === 1 ? "switch" : "switches"} overridden (${granted} granted, ${revoked} revoked)`;

  const chip = "rounded-[3px] px-1 py-px text-[11px] leading-[13px] font-medium tracking-[0.4px] text-white";

  return (
    <WzWindowFrame
      title={`Edit permissions for ${name}`}
      titleAfter={
        <span className="flex shrink-0 gap-1">
          <span className={`${chip} bg-wz-link`}>{role.name}</span>
          {saved.any ? <span className={`${chip} bg-wz-slate`}>Custom permissions</span> : null}
        </span>
      }
      onClose={onClose}
      closeLabel="Close the permissions"
      footer={
        <>
          <div className="mr-auto flex items-center gap-3 text-[13px] leading-[19px] text-wz-strong">
            {!readOnly && saved.any ? (
              <WzButton variant="secondary" size="regular" disabled={pending} onClick={() => setConfirmReset(true)}>
                Reset to role defaults
              </WzButton>
            ) : null}
            {!readOnly && dirty ? (
              <>
                <span role="status">
                  Unsaved changes · applies immediately to <b>{user.firstName}</b>
                </span>
                <WzButton variant="tertiary" size="regular" onClick={() => setDraft(initial)}>
                  Discard
                </WzButton>
              </>
            ) : null}
          </div>
          <WzButton variant="secondary" size="big" className="min-w-[98px]" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </WzButton>
          {!readOnly ? (
            <WzButton
              variant="primary"
              size="big"
              loading={pending}
              disabled={!dirty}
              className="disabled:bg-wz-disabled-fill disabled:hover:bg-wz-disabled-fill [&:disabled>span]:text-wz-outline"
              onClick={() => setConfirmSave(true)}
            >
              Save
            </WzButton>
          ) : null}
        </>
      }
    >
      <WzTabBar
        aria-label="Permissions"
        className="pt-1"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "actions", label: "Actions" },
          { value: "reports", label: "Reports" },
          { value: "advanced", label: "Advanced" },
        ]}
      />
      <OverridesNote user={user} role={role} readOnly={readOnly} canEditUsers={can("users", "edit")} isSelf={isSelf(user)} />

      {tab === "actions" || tab === "reports" ? (
        <PermissionTab
          key={tab}
          section={tab}
          schema={schema}
          permissions={draft.permissions}
          baseline={basePermissions}
          readOnly={readOnly}
          onChange={(permissions) => setDraft((d) => ({ ...d, permissions }))}
          summary={summary}
        />
      ) : null}

      {tab === "advanced" ? (
        <RulesTab>
          <RulesSection title="Data scope" helper={`Choose which records ${user.firstName} reaches in each area`}>
            <DataScopeEditor
              schema={schema}
              dataScope={draft.dataScope}
              baseline={baseScopes}
              readOnly={readOnly}
              onChange={(dataScope) => setDraft((d) => ({ ...d, dataScope }))}
            />
          </RulesSection>
          <RulesSection title="Job stages" helper={`Choose which stage moves ${user.firstName} may make`}>
            <WzSwitchRow
              title="Override the role's stage transitions"
              description={
                draft.transitionsOverridden
                  ? "This list fully replaces the role's transitions for this user."
                  : `Inherited from “${role.name}”.`
              }
            >
              <WzSwitch
                aria-label="Override the role's stage transitions"
                checked={draft.transitionsOverridden}
                disabled={readOnly}
                onCheckedChange={(on) =>
                  setDraft((d) => ({
                    ...d,
                    transitionsOverridden: on,
                    dealStageTransitions: on ? d.dealStageTransitions : [...role.dealStageTransitions],
                  }))
                }
              />
            </WzSwitchRow>
            <StageTransitionsEditor
              transitions={draft.dealStageTransitions}
              readOnly={readOnly || !draft.transitionsOverridden}
              onChange={(dealStageTransitions) => setDraft((d) => ({ ...d, dealStageTransitions }))}
            />
          </RulesSection>
        </RulesTab>
      ) : null}

      {/* Confirm: save */}
      <AlertDialog open={confirmSave} onOpenChange={setConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {sparse === null ? "Remove all custom permissions?" : `Save custom permissions for ${user.firstName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {sparse === null ? (
                <>
                  Everything now matches the <b>{role.name}</b> role, so the stored overrides will be removed.
                </>
              ) : (
                <>
                  {cellValues.length > 0
                    ? `${cellValues.length} permission ${cellValues.length === 1 ? "change" : "changes"} (${granted} granted, ${revoked} revoked)`
                    : "No permission changes"}
                  {scopeChanges > 0 ? `, ${scopeChanges} data scope ${scopeChanges === 1 ? "change" : "changes"}` : ""}
                  {sparse.dealStageTransitions !== undefined ? ", custom stage transitions" : ""}. They apply on top
                  of the <b>{role.name}</b> role and take effect immediately.
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
            <AlertDialogTitle>Remove all custom permissions for {user.firstName}?</AlertDialogTitle>
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
    </WzWindowFrame>
  );
}

/** Ours: why the switches are greyed, or what saving does — a quiet line under the tabs. */
function OverridesNote({
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
  let node: { icon: ReactNode; text: string };
  if (readOnly) {
    if (isSelf) node = { icon: <Lock className="size-4" />, text: "You can't change your own permission overrides." };
    else if (isSuperAdmin(role)) node = { icon: <Lock className="size-4" />, text: "Super Admin permissions can't be overridden." };
    else if (canEditUsers)
      node = { icon: <Lock className="size-4" />, text: "This user's role ranks at or above yours, so this is read-only." };
    else node = { icon: <Info className="size-4" />, text: "You have view-only access to users." };
  } else {
    node = {
      icon: <Info className="size-4" />,
      text: `Changes apply on top of the “${role.name}” role for ${user.firstName} only. Assigning a different role clears all overrides.`,
    };
  }
  return (
    <p role="note" className="mt-4 flex items-center gap-2 px-5 text-[13px] leading-[19px] tracking-[0.4px] text-wz-outline-label">
      {node.icon}
      {node.text}
    </p>
  );
}

function CenterMessage({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}
