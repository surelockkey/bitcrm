"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Brand } from "@bitcrm/types";
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
import { Textarea } from "@/components/ui/textarea";
import { useCreateBrand, useUpdateBrand } from "../hooks";
import { brandFormSchema, toBrandBody } from "../schemas";

export function BrandFormDialog({
  brand,
  open,
  onOpenChange,
}: {
  brand?: Brand;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const editing = Boolean(brand);
  const create = useCreateBrand();
  const update = useUpdateBrand(brand?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(brand?.name ?? "");
  const [description, setDescription] = useState(brand?.description ?? "");
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => brandFormSchema.safeParse({ name, description }),
    [name, description],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const mutation = editing ? update : create;
    mutation.mutate(toBrandBody(parsed.data), { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit brand" : "New brand"}</DialogTitle>
          <DialogDescription>
            Brands group products by who makes them. A product picks one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="brand-name">Brand name</Label>
            <Input
              id="brand-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Kwikset"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brand-description">Description</Label>
            <Textarea
              id="brand-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
