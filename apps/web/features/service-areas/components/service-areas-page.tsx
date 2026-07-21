"use client";

import { useState } from "react";
import { Loader2, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import type { ServiceArea } from "@bitcrm/types";
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
import { useServiceAreas, useDeleteServiceArea } from "../hooks";
import { describeArea } from "../lib";
import { ServiceAreaFormDialog } from "./service-area-form-dialog";

export function ServiceAreasPage() {
  const { can } = usePermissions();
  const { data: areas, isLoading } = useServiceAreas();
  const del = useDeleteServiceArea();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceArea | undefined>();
  const [deleting, setDeleting] = useState<ServiceArea | undefined>();

  const canCreate = can("service_areas", "create");
  const canEdit = can("service_areas", "edit");
  const canDelete = can("service_areas", "delete");

  if (!can("service_areas", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view service areas.
        </p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (area: ServiceArea) => {
    setEditing(area);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Service areas</h2>
          <p className="text-sm text-muted-foreground">
            Territories used to auto-assign deals and match technicians. Areas can&apos;t overlap.
          </p>
        </div>
        {canCreate ? (
          <Button variant="brand" className="h-9 gap-1.5" onClick={openNew}>
            <Plus className="size-4" /> New service area
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !areas || areas.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <MapPin className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No service areas yet</p>
          <p className="text-sm text-muted-foreground">
            Create one to start auto-assigning deals by address.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Definition</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {areas.map((area) => (
                <TableRow key={area.id}>
                  <TableCell className="font-medium">{area.name}</TableCell>
                  <TableCell className="text-muted-foreground">{describeArea(area)}</TableCell>
                  <TableCell>{area.priority}</TableCell>
                  <TableCell>
                    <Badge variant={area.active ? "default" : "secondary"}>
                      {area.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canEdit ? (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(area)} aria-label="Edit">
                          <Pencil className="size-4" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => setDeleting(area)} aria-label="Delete">
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
      )}

      {formOpen ? (
        <ServiceAreaFormDialog
          key={editing?.id ?? "new"}
          area={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete service area?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleting?.name}&rdquo; will be removed. Deals already assigned keep their label;
              new deals in this territory will no longer auto-resolve to it.
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
