"use client";

import { useEffect, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Info, Lock } from "lucide-react";
import { DataScope } from "@bitcrm/types";
import type { Role, PermissionMatrix, DataScopeRules } from "@bitcrm/types";
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
import { WzFormSectionTitle } from "@/components/workiz/form-section-title";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { WzTabBar } from "@/components/workiz/tab-bar";
import { WzTextarea } from "@/components/workiz/textarea";
import { WzWindowFrame } from "@/components/workiz/window-frame";
import { usePermissions } from "@/features/auth/use-permissions";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useRole, useRoles, useRoleSchema, useRoleMembers, useUpdateRole } from "../hooks";
import { useRoleAccess, type RoleEditability } from "../use-role-access";
import { roleDetailsSchema } from "../schemas";
import { clearMatrix, countGrants, diffCells, isSuperAdmin, normalizeMatrix, sortRolesByPriority, type Schema } from "../lib";
import { DataScopeEditor } from "./data-scope-editor";
import { EditorSkeleton, PermissionTab, RulesSection, RulesTab } from "./permission-tab";
import { StageTransitionsEditor } from "./stage-transitions-editor";
import { RoleMembers } from "./role-members";

interface RoleDraft {
  name: string;
  description: string;
  permissions: PermissionMatrix;
  dataScope: DataScopeRules;
  dealStageTransitions: string[];
  priority: number;
}

function toDraft(role: Role, schema: Schema): RoleDraft {
  return {
    name: role.name,
    description: role.description ?? "",
    permissions: normalizeMatrix(role.permissions, schema),
    dataScope: { ...role.dataScope },
    dealStageTransitions: [...role.dealStageTransitions],
    priority: role.priority,
  };
}

function isDirty(draft: RoleDraft, role: Role, schema: Schema): boolean {
  if (draft.name.trim() !== role.name) return true;
  if ((draft.description.trim() || undefined) !== (role.description || undefined)) return true;
  if (draft.priority !== role.priority) return true;
  if (diffCells(draft.permissions, role.permissions, schema) > 0) return true;
  for (const resource of Object.keys(schema)) {
    const a = draft.dataScope[resource] ?? DataScope.ALL;
    const b = role.dataScope[resource] ?? DataScope.ALL;
    if (a !== b) return true;
  }
  const a = new Set(draft.dealStageTransitions);
  const b = new Set(role.dealStageTransitions);
  if (a.size !== b.size || [...a].some((x) => !b.has(x))) return true;
  return false;
}

const LIST = "/admin/roles";

/**
 * A role's permissions as Workiz's "Edit permissions for role …" — the
 * full-window modal Roles & Permissions opens on a role
 * (pg_admin_users_wz_10_role_dispatch), here a page of its own so a role has
 * an address. Loader + access gate: the editor is keyed by the role's
 * identity + `updatedAt`, so a fresh copy (after save) re-seeds the draft.
 */
export function RoleEditorPage({ roleId }: { roleId: string }) {
  const router = useRouter();
  const { isLoading: permsLoading } = usePermissions();
  const roleQuery = useRole(roleId);
  const schemaQuery = useRoleSchema();
  const schema = schemaQuery.data;
  const { canViewRoles } = useRoleAccess();
  // What the editor shows besides the role, asked for with it: who holds the
  // role (the Members tab's count, the save warning) and every role (whether
  // this one ranks below yours — read-only or not — and "Copy from").
  const allRoles = useRoles();
  const members = useRoleMembers(roleId);
  const ready = usePageReady(!permsLoading && [roleQuery, schemaQuery, allRoles, members].every(settled));
  const close = () => router.push(LIST);

  if (!permsLoading && !canViewRoles) {
    return <CenterMessage title="No access" body="You don't have permission to view roles." />;
  }
  if (!ready || !schema) return <EditorSkeleton onClose={close} />;
  if (roleQuery.isError || !roleQuery.data) {
    return (
      <CenterMessage
        title="Role not found"
        body="It may have been deleted."
        action={
          <WzButton variant="secondary" size="regular" onClick={close}>
            Back to roles
          </WzButton>
        }
      />
    );
  }

  const role = roleQuery.data;
  return <RoleEditor key={`${role.id}:${role.updatedAt}`} role={role} schema={schema} roleId={roleId} onClose={close} />;
}

function RoleEditor({ role, schema, roleId, onClose }: { role: Role; schema: Schema; roleId: string; onClose: () => void }) {
  const { data: allRoles } = useRoles();
  const { data: members } = useRoleMembers(roleId);
  const updateRole = useUpdateRole();
  const { editabilityOf } = useRoleAccess();

  const [draft, setDraft] = useState<RoleDraft>(() => toDraft(role, schema));
  const [tab, setTab] = useState("actions");
  const [confirmSave, setConfirmSave] = useState(false);

  const memberCount = members?.length;
  const editability = editabilityOf(role, memberCount);
  const readOnly = !editability.editable;
  const dirty = isDirty(draft, role, schema);
  const grants = countGrants(draft.permissions, schema);

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
    const parsed = roleDetailsSchema.safeParse({
      name: draft.name,
      description: draft.description || undefined,
      priority: draft.priority,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the role details");
      setTab("details");
      return;
    }
    setConfirmSave(false);
    updateRole.mutate({
      id: roleId,
      body: {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        permissions: draft.permissions,
        dataScope: draft.dataScope,
        dealStageTransitions: draft.dealStageTransitions,
        priority: draft.priority,
      },
    });
  };

  const requestSave = () => {
    if ((memberCount ?? 0) > 0) setConfirmSave(true);
    else save();
  };

  const otherRoles = sortRolesByPriority((allRoles ?? []).filter((r) => r.id !== role.id));
  const setPermissions = (permissions: PermissionMatrix) => setDraft((d) => ({ ...d, permissions }));

  // Ours, on Search's line: start from another role's switches, or from none.
  const tools = readOnly ? null : (
    <>
      <WzOutlinedSelect
        label="Copy permissions from"
        placeholder="Choose a role"
        options={otherRoles.map((r) => ({ value: r.id, label: r.name }))}
        value=""
        onChange={(id) => {
          const source = otherRoles.find((r) => r.id === id);
          if (source) setPermissions(normalizeMatrix(source.permissions, schema));
        }}
        className="w-[240px]"
      />
      <WzButton variant="secondary" size="regular" onClick={() => setPermissions(clearMatrix(schema))}>
        Clear all
      </WzButton>
    </>
  );

  return (
    <WzWindowFrame
      title={`Edit permissions for role ${role.name}`}
      titleAfter={<RoleChips role={role} />}
      onClose={onClose}
      closeLabel="Close the role"
      footer={
        <>
          {!readOnly && dirty ? (
            <div className="mr-auto flex items-center gap-3 text-[13px] leading-[19px] text-wz-strong">
              <span role="status">
                Unsaved changes
                {(memberCount ?? 0) > 0 ? (
                  <>
                    {" "}
                    · saving affects <b>{memberCount}</b> {memberCount === 1 ? "member" : "members"}
                  </>
                ) : null}
              </span>
              <WzButton variant="tertiary" size="regular" onClick={() => setDraft(toDraft(role, schema))}>
                Discard
              </WzButton>
            </div>
          ) : null}
          <WzButton variant="secondary" size="big" className="min-w-[98px]" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </WzButton>
          {!readOnly ? (
            <WzButton
              variant="primary"
              size="big"
              loading={updateRole.isPending}
              disabled={!dirty}
              className="disabled:bg-wz-disabled-fill disabled:hover:bg-wz-disabled-fill [&:disabled>span]:text-wz-outline"
              onClick={requestSave}
            >
              Save
            </WzButton>
          ) : null}
        </>
      }
    >
      <WzTabBar
        aria-label="Role"
        className="pt-1"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "actions", label: "Actions" },
          { value: "reports", label: "Reports" },
          { value: "advanced", label: "Advanced" },
          { value: "members", label: "Members", count: memberCount },
          { value: "details", label: "Details" },
        ]}
      />
      <AccessNote role={role} editability={editability} />

      {tab === "actions" || tab === "reports" ? (
        <PermissionTab
          key={tab}
          section={tab}
          schema={schema}
          permissions={draft.permissions}
          baseline={role.permissions}
          readOnly={readOnly}
          onChange={setPermissions}
          tools={tools}
          summary={`${grants} permissions granted`}
        />
      ) : null}

      {tab === "advanced" ? (
        <RulesTab>
          <RulesSection title="Data scope" helper="Choose which records this role reaches in each area">
            <DataScopeEditor
              schema={schema}
              dataScope={draft.dataScope}
              readOnly={readOnly}
              onChange={(dataScope) => setDraft((d) => ({ ...d, dataScope }))}
            />
          </RulesSection>
          <RulesSection title="Job stages" helper="Choose which stage moves this role may make">
            <StageTransitionsEditor
              transitions={draft.dealStageTransitions}
              readOnly={readOnly}
              onChange={(dealStageTransitions) => setDraft((d) => ({ ...d, dealStageTransitions }))}
            />
          </RulesSection>
        </RulesTab>
      ) : null}

      {tab === "members" ? (
        <div className="px-5 pt-5">
          <RoleMembers roleId={roleId} />
        </div>
      ) : null}

      {tab === "details" ? <DetailsForm draft={draft} readOnly={readOnly} onChange={setDraft} /> : null}

      <AlertDialog open={confirmSave} onOpenChange={setConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply changes to {memberCount} members?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone with the <b>{role.name}</b> role will get the updated permissions immediately. Their cached
              access is refreshed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={save}>Save changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WzWindowFrame>
  );
}

/** System / Custom (+ Locked on Super Admin), in the Team grid's `tag small` shape. */
function RoleChips({ role }: { role: Role }) {
  const chip = "rounded-[3px] px-1 py-px text-[11px] leading-[13px] font-medium tracking-[0.4px] text-white";
  return (
    <span className="flex shrink-0 gap-1">
      <span className={`${chip} ${role.isSystem ? "bg-wz-link" : "bg-wz-slate"}`}>{role.isSystem ? "System" : "Custom"}</span>
      {isSuperAdmin(role) ? <span className={`${chip} bg-wz-outline`}>Locked</span> : null}
    </span>
  );
}

/** Ours: why the switches are greyed, or what saving touches — a quiet line under the tabs. */
function AccessNote({ role, editability }: { role: Role; editability: RoleEditability }) {
  let node: { icon: ReactNode; text: string } | null = null;
  if (editability.locked) {
    node = { icon: <Lock className="size-4" />, text: "This is the Super Admin role — it can't be changed." };
  } else if (editability.aboveMe) {
    node = { icon: <Lock className="size-4" />, text: "This role ranks at or above yours, so it's read-only." };
  } else if (!editability.editable) {
    node = { icon: <Info className="size-4" />, text: "You have view-only access to roles." };
  } else if (role.isSystem) {
    node = { icon: <Info className="size-4" />, text: "Built-in role — changes apply to everyone who has it." };
  }
  if (!node) return null;
  return (
    <p role="note" className="mt-4 flex items-center gap-2 px-5 text-[13px] leading-[19px] tracking-[0.4px] text-wz-outline-label">
      {node.icon}
      {node.text}
    </p>
  );
}

/** Ours: the role's name, what it is for and its rank — the user page's 480px column of Workiz boxes. */
function DetailsForm({
  draft,
  readOnly,
  onChange,
}: {
  draft: RoleDraft;
  readOnly?: boolean;
  onChange: Dispatch<SetStateAction<RoleDraft>>;
}) {
  return (
    <div className="flex w-[480px] max-w-full flex-col gap-6 px-5 pt-6">
      <WzOutlinedTextField
        label="Name"
        value={draft.name}
        disabled={readOnly}
        onChange={(e) => onChange((d) => ({ ...d, name: e.target.value }))}
      />
      <div>
        <WzFormSectionTitle className="mb-2">Description</WzFormSectionTitle>
        <WzTextarea
          aria-label="Description"
          rows={3}
          value={draft.description}
          disabled={readOnly}
          placeholder="What is this role for?"
          onChange={(e) => onChange((d) => ({ ...d, description: e.target.value }))}
        />
      </div>
      <div>
        <WzOutlinedTextField
          label="Priority"
          type="number"
          min={1}
          max={99}
          className="w-40"
          value={draft.priority}
          disabled={readOnly}
          onChange={(e) => onChange((d) => ({ ...d, priority: Number(e.target.value) }))}
        />
        <p className="mt-2 text-xs leading-[18px] text-wz-outline-label">
          Higher = more powerful. Must stay below 100 and below your own role.
        </p>
      </div>
    </div>
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
