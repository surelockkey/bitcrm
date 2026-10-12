"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ClipboardList, GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import type { CustomFieldDefinition, CustomFieldEntityType, CustomFieldType } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
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
import { WzOnOffSwitch } from "@/components/workiz/on-off-switch";
import { WzSettingsBar, WzSettingsHeader } from "@/components/workiz/settings-page";
import { WzTabBar, type WzTab } from "@/components/workiz/tab-bar";
import { usePermissions } from "@/features/auth/use-permissions";
import { useJobTypes } from "@/features/job-types/hooks";
import { cn } from "@/lib/utils";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useAllCustomFields, useDeleteCustomField, useReorderCustomFields, useUpdateCustomField } from "../hooks";
import { clientCustomFields, groupFields, jobCustomFields, reorderPriorities, stepTarget } from "../lib";
import { CustomFieldFormDialog } from "./custom-field-form-dialog";

/** The Type column's words, Workiz's (capitalised by the cell): "Drop Down", "Files". */
const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "text",
  large_text: "large text",
  number: "number",
  checkbox: "checkbox",
  dropdown: "drop down",
  date: "date",
  file: "files",
  multi_select: "multi select",
};

/** Workiz's tabs over the table (app_audit_wz_customfields: Tabs-module, 13px/19px). */
const TABS: WzTab[] = [
  { value: "job", label: "Job/Lead" },
  { value: "client", label: "Client" },
];

/*
 * Workiz's custom-fields table (`table.simple-table`, uikit_wz_set_customfields,
 * pg_settings_catalogs_wz_customfields): white; a 57px head of 15px/16px 500
 * black capitalised names (20px 12px); a #f7f7f7 55px row per group — a
 * chevron that folds it, "Group: Company" in 14px bold 98px in; a 56px white
 * row per field, its name 105px in, the rows ruled #e6e6e6 (the first group
 * under #ccc). A field row opens its edit. Workiz's rows are ui-sortable: the
 * first (empty) column holds ours' drag handle.
 */
const TH = "h-[57px] px-3 text-left align-middle text-[15px] leading-4 font-medium text-black capitalize";
const TD = "border-t border-[#e6e6e6] px-3 py-[15px] align-middle text-sm leading-4 text-wz-strong";

/**
 * Settings → Custom Fields, as Workiz's: the band, the Job/Lead · Client tabs
 * (`?tab=client` opens the second, so the client card can link to it), "Add
 * New" at the right, and the grouped table — Name, Job Type ("All Types" when
 * it applies to every one), Type, Required on Job/Lead; Name and Type on
 * Client (a client field has neither job types nor a required flag). Rows are
 * ordered by dragging them within their group (Workiz), or with the arrow keys
 * on the row's handle; the order is the fields' priority, written for the rows
 * that moved. Workiz's delete-a-whole-group is left out (ours: a field's own
 * delete). The ON/OFF Status is ours, as on Job Types. The drawer is Workiz's
 * "Add New Field".
 */
export function CustomFieldsPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const tab: CustomFieldEntityType = search.get("tab") === "client" ? "client" : "job";
  const fieldsQuery = useAllCustomFields();
  // The Job Type column names the types: they join the gate, so the column
  // never shows ids that turn into names a beat later.
  const jobTypesQuery = useJobTypes();
  const jobTypes = jobTypesQuery.data;
  // One skeleton until the user, the fields and the types are in: "Add New"
  // and the rows come in the same frame, and nobody is refused for the beat
  // their permissions are still on the way.
  const ready = usePageReady(!permsLoading && settled(fieldsQuery) && settled(jobTypesQuery));
  const del = useDeleteCustomField();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDefinition | undefined>();
  const [deleting, setDeleting] = useState<CustomFieldDefinition | undefined>();

  const canCreate = can("custom_fields", "create");
  const canEdit = can("custom_fields", "edit");
  const canDelete = can("custom_fields", "delete");

  const fields = useMemo(
    () => (tab === "client" ? clientCustomFields(fieldsQuery.data) : jobCustomFields(fieldsQuery.data)),
    [fieldsQuery.data, tab],
  );
  const typeName = useMemo(() => new Map((jobTypes ?? []).map((t) => [t.id, t.name])), [jobTypes]);

  if (!permsLoading && !can("custom_fields", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view custom fields.
        </p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (field: CustomFieldDefinition) => {
    if (!canEdit) return;
    setEditing(field);
    setFormOpen(true);
  };
  const switchTab = (next: string) =>
    router.replace(next === "client" ? `${pathname}?tab=client` : pathname, { scroll: false });
  const jobTypesOf = (field: CustomFieldDefinition) =>
    field.jobTypeIds.length === 0 ? "All Types" : field.jobTypeIds.map((id) => typeName.get(id) ?? id).join(", ");

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <WzSettingsHeader
        icon={<ClipboardList />}
        title="Custom Fields"
        description="Need more information on your jobs? Add your own custom fields."
      />
      <WzTabBar aria-label="Custom field tabs" variant="small" tabs={TABS} value={tab} onValueChange={switchTab} className="mt-1 shrink-0" />
      {!ready ? (
        <div className="px-5 pt-5">
          <Skeleton className="h-[480px] w-full rounded-none" />
        </div>
      ) : (
        <>
          <WzSettingsBar
            className="justify-end"
            action={
              canCreate ? (
                <WzButton size="regular" icon={<Plus strokeWidth={1.75} />} onClick={openNew}>
                  Add New
                </WzButton>
              ) : null
            }
          />
          <FieldsTable
            key={tab}
            tab={tab}
            fields={fields}
            canEdit={canEdit}
            canDelete={canDelete}
            jobTypesOf={jobTypesOf}
            onEdit={openEdit}
            onDelete={setDeleting}
          />
        </>
      )}

      {formOpen ? (
        <CustomFieldFormDialog
          key={editing?.id ?? `new-${tab}`}
          customField={editing}
          entityType={tab}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete custom field?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleting?.name}&rdquo; will be removed. If any {tab === "client" ? "client" : "deal"} still
              has a value for it, it&apos;s archived instead — it leaves the forms but the{" "}
              {tab === "client" ? "clients" : "historical deals"} keep their data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) del.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) });
              }}
            >
              {del.isPending ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * One tab's grouped table. Its rows drag within their group (`@dnd-kit`, a
 * pointer drag — the handle is the row's first cell); the handle also takes
 * the arrow keys, one place a press, so the order is reachable without a
 * mouse. A move writes the moved rows' priorities (`reorderPriorities`) and
 * says where the row went in a polite live region.
 */
function FieldsTable({
  tab,
  fields,
  canEdit,
  canDelete,
  jobTypesOf,
  onEdit,
  onDelete,
}: {
  tab: CustomFieldEntityType;
  fields: CustomFieldDefinition[];
  canEdit: boolean;
  canDelete: boolean;
  jobTypesOf: (field: CustomFieldDefinition) => string;
  onEdit: (field: CustomFieldDefinition) => void;
  onDelete: (field: CustomFieldDefinition) => void;
}) {
  const reorder = useReorderCustomFields();
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const [refocus, setRefocus] = useState<string | null>(null);
  const hintId = useId();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const groups = useMemo(() => groupFields(fields), [fields]);
  const job = tab === "job";
  const columns = 4 + (job ? 2 : 0) + (canDelete ? 1 : 0);

  // A row moved by the keys is re-placed in the DOM, which takes the focus
  // off its handle: hand it back.
  useEffect(() => {
    if (!refocus) return;
    [...document.querySelectorAll<HTMLButtonElement>("[data-move-handle]")]
      .find((el) => el.dataset.moveHandle === refocus)
      ?.focus();
    setRefocus(null);
  }, [refocus, fields]);

  const move = (list: CustomFieldDefinition[], group: string, activeId: string, overId: string) => {
    const changes = reorderPriorities(list, activeId, overId);
    if (!changes.length) return;
    reorder.mutate(changes);
    const name = list.find((f) => f.id === activeId)?.name ?? "";
    const at = list.findIndex((f) => f.id === overId) + 1;
    setAnnouncement(`${name} moved to position ${at} of ${list.length} in ${group}`);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const g = groups.find((x) => x.fields.some((f) => f.id === active.id));
    // Within a group only: a field changes group in its drawer.
    if (!g || !g.fields.some((f) => f.id === over.id)) return;
    move(g.fields, g.group, String(active.id), String(over.id));
  };

  const onHandleKey = (e: KeyboardEvent, list: CustomFieldDefinition[], group: string, id: string) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const target = stepTarget(list, id, e.key === "ArrowUp" ? -1 : 1);
    if (!target) return;
    move(list, group, id, target);
    setRefocus(id);
  };

  const toggleGroup = (group: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
      <p id={hintId} className="sr-only">
        Drag the handle to reorder, or press the up or down arrow key.
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <table
        aria-label={job ? "Custom fields" : "Client custom fields"}
        className="w-full table-fixed border-collapse bg-white"
      >
        <colgroup>
          <col className="w-[50px]" />
          <col />
          {job ? <col className="w-[45%]" /> : null}
          <col className="w-[151px]" />
          {job ? <col className="w-[137px]" /> : null}
          <col className="w-[120px]" />
          {canDelete ? <col className="w-[60px]" /> : null}
        </colgroup>
        <thead>
          <tr>
            <th className={TH}>
              <span className="sr-only">Order</span>
            </th>
            <th className={TH}>name</th>
            {job ? <th className={TH}>Job Type</th> : null}
            <th className={TH}>type</th>
            {job ? <th className={TH}>required</th> : null}
            <th className={TH}>status</th>
            {canDelete ? (
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        {groups.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={columns} className={cn(TD, "border-input py-10 text-center text-[15px] font-medium")}>
                No Records Found
              </td>
            </tr>
          </tbody>
        ) : (
          groups.map(({ group, fields: list }, gi) => {
            const open = !folded.has(group);
            return (
              <tbody key={group}>
                <tr className="bg-muted">
                  <td
                    colSpan={columns}
                    className={cn(
                      "h-[55px] border-t px-2.5 py-[15px] align-middle text-sm leading-4 text-wz-strong",
                      gi === 0 ? "border-input" : "border-[#e6e6e6]",
                    )}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggleGroup(group)}
                      className="ml-[43px] flex items-center gap-[27px] outline-none focus-visible:underline"
                    >
                      <ChevronDown
                        aria-hidden
                        className={cn("size-[18px] text-wz-strong transition-transform", !open && "-rotate-90")}
                        strokeWidth={1.5}
                      />
                      <b className="font-bold capitalize">Group: {group}</b>
                    </button>
                  </td>
                </tr>
                {open ? (
                  <SortableContext items={list.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                    {list.map((field) => (
                      <FieldRow
                        key={field.id}
                        field={field}
                        job={job}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        hintId={hintId}
                        jobTypes={job ? jobTypesOf(field) : ""}
                        onEdit={() => onEdit(field)}
                        onDelete={() => onDelete(field)}
                        onHandleKey={(e) => onHandleKey(e, list, group, field.id)}
                      />
                    ))}
                  </SortableContext>
                ) : null}
              </tbody>
            );
          })
        )}
      </table>
    </DndContext>
  );
}

/** A field's row; with `custom_fields.edit` its first cell is the drag handle. */
function FieldRow({
  field,
  job,
  canEdit,
  canDelete,
  hintId,
  jobTypes,
  onEdit,
  onDelete,
  onHandleKey,
}: {
  field: CustomFieldDefinition;
  job: boolean;
  canEdit: boolean;
  canDelete: boolean;
  hintId: string;
  jobTypes: string;
  onEdit: () => void;
  onDelete: () => void;
  onHandleKey: (e: KeyboardEvent) => void;
}) {
  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
    disabled: !canEdit,
  });
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={canEdit ? onEdit : undefined}
      className={cn(
        "h-14 bg-white",
        canEdit && "cursor-pointer hover:bg-black/[0.03]",
        isDragging && "relative z-10 shadow-[0_2px_10px_rgba(0,0,0,0.12)]",
      )}
    >
      <td className={cn(TD, "text-center")}>
        {canEdit ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            data-move-handle={field.id}
            aria-label={`Move ${field.name}`}
            aria-describedby={hintId}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onHandleKey}
            {...listeners}
            className="inline-grid size-6 cursor-grab touch-none place-items-center rounded-[4px] text-wz-text outline-none hover:text-wz-strong focus-visible:ring-2 focus-visible:ring-wz-focus active:cursor-grabbing"
          >
            <GripVertical className="size-4" strokeWidth={1.5} />
          </button>
        ) : null}
      </td>
      <td className={cn(TD, "truncate")}>
        {canEdit ? (
          <button
            type="button"
            aria-label={`Edit ${field.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="ml-[43px] max-w-full truncate text-left outline-none focus-visible:underline"
          >
            {field.name}
          </button>
        ) : (
          <span className="ml-[43px]">{field.name}</span>
        )}
      </td>
      {job ? <td className={cn(TD, "truncate")}>{jobTypes}</td> : null}
      <td className={cn(TD, "capitalize")}>{TYPE_LABELS[field.type]}</td>
      {job ? <td className={TD}>{field.required ? "Yes" : "No"}</td> : null}
      <td className={TD} onClick={(e) => e.stopPropagation()}>
        <CustomFieldStatusSwitch field={field} disabled={!canEdit} />
      </td>
      {canDelete ? (
        <td className={cn(TD, "text-right")}>
          <button
            type="button"
            aria-label={`Delete ${field.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="inline-grid size-6 place-items-center rounded-[4px] text-wz-text outline-none hover:text-wz-strong focus-visible:ring-2 focus-visible:ring-wz-focus"
          >
            <Trash2 className="size-[17px]" strokeWidth={1.5} />
          </button>
        </td>
      ) : null}
    </tr>
  );
}

/** A field's Status switch: off archives it (it leaves the forms; what was answered stays). */
function CustomFieldStatusSwitch({ field, disabled }: { field: CustomFieldDefinition; disabled: boolean }) {
  const update = useUpdateCustomField(field.id);
  const pending = update.isPending ? (update.variables as { active?: boolean } | undefined)?.active : undefined;
  return (
    <WzOnOffSwitch
      aria-label={`${field.name} status`}
      checked={pending ?? field.active}
      disabled={disabled || update.isPending}
      onCheckedChange={(active) => update.mutate({ active })}
    />
  );
}
