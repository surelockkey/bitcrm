"use client";

import { useEffect, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  CopyPlus,
  Eraser,
  Info,
  Loader2,
  Lock,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { DataScope } from "@bitcrm/types";
import type { Role, PermissionMatrix, DataScopeRules } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useRole, useRoles, useRoleSchema, useRoleMembers, useUpdateRole } from "../hooks";
import { useRoleAccess, type RoleEditability } from "../use-role-access";
import { roleDetailsSchema } from "../schemas";
import {
  clearMatrix,
  countGrants,
  diffCells,
  isSuperAdmin,
  normalizeMatrix,
  roleSwatch,
  sortRolesByPriority,
  type Schema,
} from "../lib";
import { RoleTypeBadge } from "./role-type-badge";
import { PermissionMatrixEditor } from "./permission-matrix";
import { DataScopeEditor } from "./data-scope-editor";
import { StageTransitionsEditor } from "./stage-transitions-editor";
import { RoleMembers } from "./role-members";
import { DeleteRoleDialog } from "./delete-role-dialog";

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

/**
 * Loader + access gate. Renders the editor keyed by the role's identity +
 * `updatedAt` so a fresh copy (after save) cleanly re-seeds the draft — no
 * syncing effect required.
 */
export function RoleEditorPage({ roleId }: { roleId: string }) {
  const router = useRouter();
  const roleQuery = useRole(roleId);
  const { data: schema } = useRoleSchema();
  const { canViewRoles } = useRoleAccess();

  if (!canViewRoles) {
    return <CenterMessage title="No access" body="You don't have permission to view roles." />;
  }
  if (roleQuery.isLoading || !schema) return <EditorSkeleton />;
  if (roleQuery.isError || !roleQuery.data) {
    return (
      <CenterMessage
        title="Role not found"
        body="It may have been deleted."
        action={
          <Button variant="outline" onClick={() => router.push("/admin/roles")}>
            Back to roles
          </Button>
        }
      />
    );
  }

  const role = roleQuery.data;
  return (
    <RoleEditor
      key={`${role.id}:${role.updatedAt}`}
      role={role}
      schema={schema}
      roleId={roleId}
    />
  );
}

function RoleEditor({
  role,
  schema,
  roleId,
}: {
  role: Role;
  schema: Schema;
  roleId: string;
}) {
  const router = useRouter();
  const { data: allRoles } = useRoles();
  const { data: members } = useRoleMembers(roleId);
  const updateRole = useUpdateRole();
  const { editabilityOf } = useRoleAccess();

  const [draft, setDraft] = useState<RoleDraft>(() => toDraft(role, schema));
  const [tab, setTab] = useState("permissions");
  const [confirmSave, setConfirmSave] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  const goBack = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    router.push("/admin/roles");
  };

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

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={goBack}>
          <ArrowLeft className="size-4" />
          Roles
        </Button>
        <span
          className="size-2.5 flex-none rounded-[3px]"
          style={{ background: roleSwatch(role.id) }}
        />
        <h1 className="truncate text-lg font-semibold tracking-tight">{role.name}</h1>
        <RoleTypeBadge role={role} />
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          priority {role.priority}
        </span>
        {!isSuperAdmin(role) ? (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            aria-label="Delete role"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>

      <AccessBanner role={role} editability={editability} />

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col">
        <div className="border-b px-6">
          <TabsList variant="line" className="h-11">
            <TabsTrigger value="permissions" className="px-2">Permissions</TabsTrigger>
            <TabsTrigger value="scope" className="px-2">Data scope</TabsTrigger>
            <TabsTrigger value="stages" className="px-2">Deal stages</TabsTrigger>
            <TabsTrigger value="members" className="px-2">
              Members{memberCount !== undefined ? ` · ${memberCount}` : ""}
            </TabsTrigger>
            <TabsTrigger value="details" className="px-2">Details</TabsTrigger>
          </TabsList>
        </div>

        {!readOnly && dirty ? (
          <div className="flex items-center gap-3 border-y border-amber-500/30 bg-amber-500/10 px-6 py-2 text-sm text-amber-700 dark:text-amber-500">
            <TriangleAlert className="size-4 flex-none" />
            <span>
              Unsaved changes
              {(memberCount ?? 0) > 0 ? (
                <>
                  {" "}
                  · saving affects <b>{memberCount}</b>{" "}
                  {memberCount === 1 ? "member" : "members"}
                </>
              ) : null}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDraft(toDraft(role, schema))}>
                Discard
              </Button>
              <Button
                variant="brand"
                size="sm"
                className="gap-1.5"
                disabled={updateRole.isPending}
                onClick={requestSave}
              >
                {updateRole.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Save changes
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <TabsContent value="permissions" className="mt-0">
            {!readOnly ? (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">{grants} permissions granted</span>
                <span className="ml-auto flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1.5">
                        <CopyPlus className="size-3.5" />
                        Start from…
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuLabel>Copy permissions from</DropdownMenuLabel>
                      {otherRoles.map((r) => (
                        <DropdownMenuItem
                          key={r.id}
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              permissions: normalizeMatrix(r.permissions, schema),
                            }))
                          }
                        >
                          {r.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setDraft((d) => ({ ...d, permissions: clearMatrix(schema) }))}
                  >
                    <Eraser className="size-3.5" />
                    Clear all
                  </Button>
                </span>
              </div>
            ) : null}
            <div className="rounded-lg border">
              <PermissionMatrixEditor
                schema={schema}
                permissions={draft.permissions}
                baseline={role.permissions}
                readOnly={readOnly}
                onChange={(permissions) => setDraft((d) => ({ ...d, permissions }))}
              />
            </div>
          </TabsContent>

          <TabsContent value="scope" className="mt-0">
            <DataScopeEditor
              schema={schema}
              dataScope={draft.dataScope}
              readOnly={readOnly}
              onChange={(dataScope) => setDraft((d) => ({ ...d, dataScope }))}
            />
          </TabsContent>

          <TabsContent value="stages" className="mt-0">
            <StageTransitionsEditor
              transitions={draft.dealStageTransitions}
              readOnly={readOnly}
              onChange={(dealStageTransitions) =>
                setDraft((d) => ({ ...d, dealStageTransitions }))
              }
            />
          </TabsContent>

          <TabsContent value="members" className="mt-0">
            <RoleMembers roleId={roleId} />
          </TabsContent>

          <TabsContent value="details" className="mt-0">
            <DetailsForm draft={draft} readOnly={readOnly} onChange={setDraft} />
          </TabsContent>
        </div>
      </Tabs>

      <AlertDialog open={confirmSave} onOpenChange={setConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply changes to {memberCount} members?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone with the <b>{role.name}</b> role will get the updated permissions
              immediately. Their cached access is refreshed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={save}>Save changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DeleteRoleDialog
        role={role}
        editability={editability}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  );
}

function AccessBanner({
  role,
  editability,
}: {
  role: Role;
  editability: RoleEditability;
}) {
  let node: { icon: ReactNode; text: string; tone: "info" | "warn" } | null = null;

  if (editability.locked) {
    node = {
      icon: <Lock className="size-4" />,
      text: "This is the Super Admin role — it can't be changed.",
      tone: "warn",
    };
  } else if (editability.aboveMe) {
    node = {
      icon: <Lock className="size-4" />,
      text: "This role ranks at or above yours, so it's read-only.",
      tone: "warn",
    };
  } else if (!editability.editable) {
    node = {
      icon: <Info className="size-4" />,
      text: "You have view-only access to roles.",
      tone: "info",
    };
  } else if (role.isSystem) {
    node = {
      icon: <Info className="size-4" />,
      text: "Built-in role — changes apply to everyone who has it.",
      tone: "info",
    };
  }

  if (!node) return null;
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
    <div className="max-w-md space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="d-name">Name</Label>
        <Input
          id="d-name"
          className="h-10"
          value={draft.name}
          disabled={readOnly}
          onChange={(e) => onChange((d) => ({ ...d, name: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="d-desc">Description</Label>
        <Textarea
          id="d-desc"
          rows={2}
          value={draft.description}
          disabled={readOnly}
          placeholder="What is this role for?"
          onChange={(e) => onChange((d) => ({ ...d, description: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="d-priority">Priority</Label>
        <Input
          id="d-priority"
          type="number"
          min={1}
          max={99}
          className="h-10 w-32"
          value={draft.priority}
          disabled={readOnly}
          onChange={(e) => onChange((d) => ({ ...d, priority: Number(e.target.value) }))}
        />
        <p className="text-xs text-muted-foreground">
          Higher = more powerful. Must stay below 100 and below your own role.
        </p>
      </div>
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
