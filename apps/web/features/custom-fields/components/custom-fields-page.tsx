"use client";

import { useMemo, useState } from "react";
import { Loader2, ListPlus, Pencil, Plus, Trash2 } from "lucide-react";
import type { CustomFieldDefinition, CustomFieldType } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { useCustomFields, useDeleteCustomField } from "../hooks";
import { groupFields } from "../lib";
import { CustomFieldFormDialog } from "./custom-field-form-dialog";

/** Friendly labels for the fixed set of input kinds. */
const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  large_text: "Large text",
  number: "Number",
  checkbox: "Checkbox",
  dropdown: "Dropdown",
  date: "Date",
  file: "File",
  multi_select: "Multi-select",
};

export function CustomFieldsPage() {
  const { can } = usePermissions();
  const { data: fields, isLoading } = useCustomFields();
  const del = useDeleteCustomField();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDefinition | undefined>();
  const [deleting, setDeleting] = useState<CustomFieldDefinition | undefined>();

  const canCreate = can("custom_fields", "create");
  const canEdit = can("custom_fields", "edit");
  const canDelete = can("custom_fields", "delete");

  const groups = useMemo(() => groupFields(fields ?? []), [fields]);

  if (!can("custom_fields", "view")) {
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
    setEditing(field);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Custom fields</h2>
          <p className="text-sm text-muted-foreground">
            User-defined fields on deals, filed under group headings and scoped to job types.
          </p>
        </div>
        {canCreate ? (
          <Button variant="brand" className="h-9 gap-1.5" onClick={openNew}>
            <Plus className="size-4" /> New custom field
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <ListPlus className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No custom fields yet</p>
          <p className="text-sm text-muted-foreground">
            Create one to capture extra details on deals.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(({ group, fields: groupFieldsList }) => (
            <div key={group} className="space-y-2">
              <h3 className="text-sm font-semibold tracking-tight text-muted-foreground">
                {group}
              </h3>
              <div className="rounded-lg border">
                {/* Fixed layout so the columns land at the same x in every
                    group's table — auto-sizing let them drift per group. */}
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="w-40">Type</TableHead>
                      <TableHead className="w-44">Flags</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead className="w-24 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupFieldsList.map((field) => (
                      <TableRow key={field.id}>
                        <TableCell className="font-medium">{field.name}</TableCell>
                        <TableCell>{TYPE_LABELS[field.type]}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {field.required ? <Badge variant="secondary">Required</Badge> : null}
                            {field.requiredToClose ? (
                              <Badge variant="secondary">Required to close</Badge>
                            ) : null}
                            {field.searchable ? <Badge variant="secondary">Searchable</Badge> : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={field.active ? "default" : "secondary"}>
                            {field.active ? "Active" : "Archived"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {canEdit ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => openEdit(field)}
                                aria-label="Edit"
                              >
                                <Pencil className="size-4" />
                              </Button>
                            ) : null}
                            {canDelete ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => setDeleting(field)}
                                aria-label="Delete"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen ? (
        <CustomFieldFormDialog
          key={editing?.id ?? "new"}
          customField={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete custom field?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleting?.name}&rdquo; will be removed. If any deal still has a value for it,
              it&apos;s archived instead — it leaves the forms but historical deals keep their data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting)
                  del.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) });
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
