"use client";

import { useState } from "react";
import { PenLine, Plus, Trash2 } from "lucide-react";
import type { ItemAttribute } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { FloatingInput, WzConfirm } from "@/features/inventory/item-edit/wz";
import {
  useCreateItemAttribute,
  useDeleteItemAttribute,
  useItemAttributes,
  useUpdateItemAttribute,
} from "../hooks";
import { inputTypeFor, renameValueKey } from "../lib";
import { CustomFieldDialog } from "./custom-field-dialog";

type Dialog = { kind: "add" } | { kind: "edit"; attribute: ItemAttribute } | { kind: "delete"; attribute: ItemAttribute };

/**
 * Workiz "Custom Fields" in the Edit Item popup — one input per field of the
 * catalog, the field's name standing in as the placeholder until there is a
 * value (then riding the top edge), a pencil (rename) and a bin (delete) on
 * the right, and "+ Add custom fields" underneath.
 *
 * The VALUES belong to the item: they change here and are sent with the
 * item's Save. The FIELDS are the catalog's: add, rename and delete go to the
 * server at once, the way Workiz does it, and a rename or delete follows
 * through into the values held here.
 */
export function CustomFields({
  values,
  onChange,
  readOnly = false,
  canManage,
  className,
}: {
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  /** The item's values can't be changed (no edit permission, or still loading). */
  readOnly?: boolean;
  /** May add, rename and delete fields (`products.edit`). */
  canManage: boolean;
  className?: string;
}) {
  const query = useItemAttributes();
  const attributes = query.data ?? [];
  const create = useCreateItemAttribute();
  const update = useUpdateItemAttribute();
  const remove = useDeleteItemAttribute();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);

  return (
    <section data-testid="custom-fields" className={cn("min-w-0", className)}>
      {query.isLoading ? (
        <div data-testid="custom-fields-loading" className="mb-4 space-y-4">
          <div className="h-[19px] w-28 animate-pulse rounded bg-[#eef0f1]" />
          <div className="h-12 animate-pulse rounded-[4px] bg-[#f3f6f7]" />
          <div className="h-12 animate-pulse rounded-[4px] bg-[#f3f6f7]" />
        </div>
      ) : attributes.length > 0 ? (
        <>
          <h3 className="mb-2 text-[13px] leading-[19px] font-semibold tracking-[0.4px] text-[#3b4b52]">
            Custom Fields
          </h3>
          <ul>
            {attributes.map((attribute) => (
              <li
                key={attribute.id}
                data-testid="custom-field-row"
                className="mr-[5px] mb-4 flex min-w-0 items-center gap-4"
              >
                <FloatingInput
                  className="flex-1"
                  label={attribute.name}
                  type={inputTypeFor(attribute)}
                  inputMode={attribute.type === "text" ? undefined : "decimal"}
                  value={values[attribute.name] ?? ""}
                  disabled={readOnly}
                  onChange={(value) => onChange({ ...values, [attribute.name]: value })}
                />
                {canManage ? (
                  <div className="flex flex-none items-center gap-4 text-[#3b4b52]">
                    <button
                      type="button"
                      aria-label={`Edit custom field ${attribute.name}`}
                      title="Edit"
                      className="rounded-sm hover:opacity-70 focus-visible:ring-2 focus-visible:ring-[#ffd400] focus-visible:outline-none"
                      onClick={() => setDialog({ kind: "edit", attribute })}
                    >
                      <PenLine className="size-6" strokeWidth={1.4} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete custom field ${attribute.name}`}
                      title="Delete"
                      className="rounded-sm hover:opacity-70 focus-visible:ring-2 focus-visible:ring-[#ffd400] focus-visible:outline-none"
                      onClick={() => setDialog({ kind: "delete", attribute })}
                    >
                      <Trash2 className="size-6" strokeWidth={1.4} />
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {canManage ? (
        <div className="mb-[30px]">
          <button
            type="button"
            onClick={() => setDialog({ kind: "add" })}
            className="flex items-center gap-2 text-[#3589e9] hover:text-[#6aa8ee] focus-visible:underline focus-visible:outline-none"
          >
            <Plus className="size-6" strokeWidth={1.75} />
            <span className="text-[13px] leading-[19px] font-medium tracking-[0.4px]">
              Add custom fields
            </span>
          </button>
        </div>
      ) : null}

      {dialog?.kind === "add" ? (
        <CustomFieldDialog
          attributes={attributes}
          pending={create.isPending}
          onOpenChange={(open) => (open ? undefined : close())}
          onSubmit={(body) => create.mutate(body, { onSuccess: close })}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <CustomFieldDialog
          key={dialog.attribute.id}
          attribute={dialog.attribute}
          attributes={attributes}
          pending={update.isPending}
          onOpenChange={(open) => (open ? undefined : close())}
          onSubmit={(body) =>
            update.mutate(
              { id: dialog.attribute.id, body },
              {
                onSuccess: (saved) => {
                  onChange(renameValueKey(values, dialog.attribute.name, saved.name));
                  close();
                },
              },
            )
          }
        />
      ) : null}
      <WzConfirm
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => (open ? undefined : close())}
        title="Delete Custom Field?"
        message="Deleting a custom field will remove its associated data. This action can not be undone."
        pending={remove.isPending}
        onConfirm={() => {
          if (dialog?.kind !== "delete") return;
          const { id, name } = dialog.attribute;
          remove.mutate(
            { id, name },
            {
              onSuccess: () => {
                const rest = { ...values };
                delete rest[name];
                onChange(rest);
                close();
              },
            },
          );
        }}
      />
    </section>
  );
}
