"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Container } from "@bitcrm/types";
import { InventoryStatus } from "@bitcrm/types";
import { useUpdateContainer } from "../hooks";

/**
 * Edit the van's own settings. The name always mirrors the technician
 * (renames flow in from the Technicians screen), so only department and
 * active status live here.
 */
export function ContainerSettingsTab({
  container,
  readOnly,
}: {
  container: Container;
  readOnly?: boolean;
}) {
  const update = useUpdateContainer();
  const [department, setDepartment] = useState(container.department ?? "");
  const [active, setActive] = useState(
    container.status === InventoryStatus.ACTIVE,
  );

  const save = () =>
    update.mutate({
      id: container.id,
      body: {
        department,
        status: active ? InventoryStatus.ACTIVE : InventoryStatus.ARCHIVED,
      },
    });

  return (
    <div className="max-w-xl space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="c-department">Department</Label>
        <Input
          id="c-department"
          className="h-10"
          disabled={readOnly}
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border px-4 py-3">
        <div>
          <Label htmlFor="c-active">Active</Label>
          <p className="text-sm text-muted-foreground">
            Inactive vans are hidden from transfer pickers.
          </p>
        </div>
        <Switch
          id="c-active"
          disabled={readOnly}
          checked={active}
          onCheckedChange={setActive}
        />
      </div>

      {!readOnly ? (
        <div className="flex justify-end">
          <Button
            variant="brand"
            disabled={update.isPending}
            className="gap-1.5"
            onClick={save}
          >
            {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      ) : null}
    </div>
  );
}
