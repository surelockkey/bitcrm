"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { ItemAttribute, ItemAttributeType } from "@bitcrm/types";
import {
  FloatingInput,
  WzButton,
  WzCheckbox,
  WzDialog,
  WzHeader,
  WzSelect,
} from "@/features/inventory/item-edit/wz";
import { ITEM_ATTRIBUTE_TYPE_OPTIONS, nameTaken } from "../lib";
import type { ItemAttributeBody } from "../api";

/** Workiz's words for a name already taken (the server answers the same with a 409). */
export const NAME_IN_USE = "Name is in use, please pick a different one";

/**
 * Workiz "Add Custom fields" / "Edit Custom field" (440 wide): Name, Type and
 * "Visible On Item List". Editing, the type is fixed, as in Workiz. Mounted
 * per opening, so it starts from the field it edits (or blank).
 */
export function CustomFieldDialog({
  attribute,
  attributes,
  pending,
  onOpenChange,
  onSubmit,
}: {
  /** The field being edited; absent to add one. */
  attribute?: ItemAttribute;
  /** The whole catalog, to refuse a name already taken. */
  attributes: ItemAttribute[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: ItemAttributeBody) => void;
}) {
  const editing = !!attribute;
  const [name, setName] = useState(attribute?.name ?? "");
  const [type, setType] = useState<ItemAttributeType>(
    (attribute?.type as ItemAttributeType | undefined) ?? "text",
  );
  const [visible, setVisible] = useState(attribute?.visible ?? false);
  const [error, setError] = useState<string>();

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Required");
      return;
    }
    if (nameTaken(attributes, trimmed, attribute?.id)) {
      toast.error(NAME_IN_USE);
      return;
    }
    onSubmit({ name: trimmed, type, visible });
  };

  return (
    <WzDialog
      open
      onOpenChange={onOpenChange}
      testId="custom-field-dialog"
      className="w-[440px] p-6"
    >
      <WzHeader title={editing ? "Edit Custom field" : "Add Custom fields"} />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <FloatingInput
          label="Name"
          name="name"
          value={name}
          autoFocus
          error={error}
          onChange={(v) => {
            setName(v);
            if (error) setError(undefined);
          }}
        />
        <WzSelect
          className="mt-4"
          placeholder="Type"
          aria-label="Type"
          value={type}
          options={ITEM_ATTRIBUTE_TYPE_OPTIONS}
          onChange={(v) => setType(v as ItemAttributeType)}
          disabled={editing}
        />
        <div className="mt-4">
          <WzCheckbox label="Visible On Item List" checked={visible} onChange={setVisible} />
        </div>
        <div className="mt-[26px] flex justify-end gap-4">
          <WzButton variant="tertiary" onClick={() => onOpenChange(false)}>
            Cancel
          </WzButton>
          <WzButton type="submit" loading={pending}>
            Save
          </WzButton>
        </div>
      </form>
    </WzDialog>
  );
}
