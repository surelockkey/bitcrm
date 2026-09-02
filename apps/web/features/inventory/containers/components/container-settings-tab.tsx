"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Container } from "@bitcrm/types";
import { InventoryStatus } from "@bitcrm/types";
import { useUpdateContainer } from "../hooks";
import { TechnicianSelect, type TechnicianOption } from "./technician-select";

/** Edit the container itself: name, description, department, tech, status. */
export function ContainerSettingsTab({
  container,
  readOnly,
}: {
  container: Container;
  readOnly?: boolean;
}) {
  const update = useUpdateContainer();
  const [name, setName] = useState(container.name ?? "");
  const [description, setDescription] = useState(container.description ?? "");
  const [department, setDepartment] = useState(container.department ?? "");
  const [technician, setTechnician] = useState<TechnicianOption | null>(
    container.technicianId
      ? { id: container.technicianId, name: container.technicianName ?? "" }
      : null,
  );
  const [active, setActive] = useState(
    container.status === InventoryStatus.ACTIVE,
  );

  const save = () =>
    update.mutate({
      id: container.id,
      body: {
        name,
        description,
        department,
        technicianId: technician?.id ?? null,
        technicianName: technician?.name ?? null,
        status: active ? InventoryStatus.ACTIVE : InventoryStatus.ARCHIVED,
      },
    });

  return (
    <div className="max-w-xl space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="c-name">Name</Label>
        <Input
          id="c-name"
          className="h-10"
          disabled={readOnly}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="c-desc">Description</Label>
        <Textarea
          id="c-desc"
          rows={3}
          disabled={readOnly}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

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

      <div className="space-y-1.5">
        <Label htmlFor="c-tech">Assigned technician</Label>
        <TechnicianSelect
          id="c-tech"
          value={technician?.id ?? null}
          currentName={technician?.name}
          onChange={setTechnician}
          disabled={readOnly}
        />
        <p className="text-sm text-muted-foreground">
          A technician can be assigned to only one container.
        </p>
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
