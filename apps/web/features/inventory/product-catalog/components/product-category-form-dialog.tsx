"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ProductCategoryWithCounts } from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateProductCategory, useUpdateProductCategory } from "../hooks";
import { productCategoryFormSchema, toProductCategoryBody } from "../schemas";
import { parentOptions } from "../lib";

/** Radix Select has no empty value, so top-level gets a sentinel. */
const TOP_LEVEL = "__top__";

export function ProductCategoryFormDialog({
  category,
  categories,
  open,
  onOpenChange,
}: {
  category?: ProductCategoryWithCounts;
  categories: ProductCategoryWithCounts[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const editing = Boolean(category);
  const create = useCreateProductCategory();
  const update = useUpdateProductCategory(category?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [parentId, setParentId] = useState(category?.parentId ?? TOP_LEVEL);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () => parentOptions(categories, category?.id),
    [categories, category?.id],
  );

  const parsed = useMemo(
    () =>
      productCategoryFormSchema.safeParse({
        name,
        description,
        parentId: parentId === TOP_LEVEL ? "" : parentId,
      }),
    [name, description, parentId],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const mutation = editing ? update : create;
    mutation.mutate(toProductCategoryBody(parsed.data), {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit category" : "New category"}</DialogTitle>
          <DialogDescription>
            Categories file your products. Nest one under another to group them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="category-name">Category name</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Deadbolts"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category-parent">Parent category</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger id="category-parent" className="w-full">
                <SelectValue placeholder="Top level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TOP_LEVEL}>Top level (no parent)</SelectItem>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {" ".repeat(option.depth * 4)}
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {editing ? (
              <p className="text-xs text-muted-foreground">
                A category can&apos;t move under one of its own subcategories.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category-description">Description</Label>
            <Textarea
              id="category-description"
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
