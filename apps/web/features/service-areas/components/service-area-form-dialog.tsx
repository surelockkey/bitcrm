"use client";

import { useMemo, useState } from "react";
import { Loader2, MapPinned, Hash } from "lucide-react";
import { ServiceAreaType, type ServiceArea, type GeoPoint } from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useCreateServiceArea, useUpdateServiceArea } from "../hooks";
import { serviceAreaFormSchema, toServiceAreaBody } from "../schemas";
import { ZipListEditor, type ZipRow } from "./zip-list-editor";
import { PolygonMapEditor } from "./polygon-map-editor";

function initialZips(area?: ServiceArea): ZipRow[] {
  if (area?.definition.type === ServiceAreaType.ZIPS) {
    return area.definition.zips.map((z) => ({ zip: z.zip, radiusMiles: z.radiusMiles ?? "" }));
  }
  return [{ zip: "", radiusMiles: "" }];
}

function initialVertices(area?: ServiceArea): GeoPoint[] {
  return area?.definition.type === ServiceAreaType.POLYGON ? area.definition.vertices : [];
}

export function ServiceAreaFormDialog({
  area,
  open,
  onOpenChange,
}: {
  area?: ServiceArea;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const editing = Boolean(area);
  const create = useCreateServiceArea();
  const update = useUpdateServiceArea(area?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(area?.name ?? "");
  const [priority, setPriority] = useState(String(area?.priority ?? 0));
  const [active, setActive] = useState(area?.active ?? true);
  const [type, setType] = useState<ServiceAreaType>(area?.type ?? ServiceAreaType.ZIPS);
  const [zips, setZips] = useState<ZipRow[]>(initialZips(area));
  const [vertices, setVertices] = useState<GeoPoint[]>(initialVertices(area));
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () =>
      serviceAreaFormSchema.safeParse({
        name,
        priority,
        active,
        type,
        zips: type === ServiceAreaType.ZIPS ? zips : [],
        vertices: type === ServiceAreaType.POLYGON ? vertices : [],
      }),
    [name, priority, active, type, zips, vertices],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = toServiceAreaBody(parsed.data);
    const mutation = editing ? update : create;
    mutation.mutate(body, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Constant width for both types (no horizontal jump); height fits content
          (may grow for the map). "Expand" opens a fullscreen map. */}
      <DialogContent className="flex max-h-[88vh] w-[95vw] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{editing ? `Edit ${area!.name}` : "New service area"}</DialogTitle>
          <DialogDescription>
            Define a territory by ZIP codes or by drawing a polygon on the map. Areas can&apos;t overlap.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input className="h-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="Atlanta Metro" />
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Input className="h-9" type="number" min={0} value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">Only active areas match addresses and block overlaps.</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <div className="grid grid-cols-2 gap-2">
              <TypeButton
                active={type === ServiceAreaType.ZIPS}
                onClick={() => setType(ServiceAreaType.ZIPS)}
                icon={<Hash className="size-4" />}
                title="ZIP codes"
                subtitle="One or many, each +N miles"
              />
              <TypeButton
                active={type === ServiceAreaType.POLYGON}
                onClick={() => setType(ServiceAreaType.POLYGON)}
                icon={<MapPinned className="size-4" />}
                title="Map polygon"
                subtitle="Draw an area by dots"
              />
            </div>
          </div>

          {type === ServiceAreaType.ZIPS ? (
            <ZipListEditor value={zips} onChange={setZips} />
          ) : (
            <PolygonMapEditor value={vertices} onChange={setVertices} />
          )}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="mx-0 mb-0 items-center rounded-none border-t px-6 py-3 sm:items-center">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant="brand" className="gap-1.5" disabled={pending || !parsed.success} onClick={submit}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TypeButton({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">{icon}{title}</span>
      <span className="text-xs text-muted-foreground">{subtitle}</span>
    </button>
  );
}
