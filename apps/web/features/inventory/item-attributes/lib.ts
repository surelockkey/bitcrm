import type { ItemAttribute, ItemAttributeType } from "@bitcrm/types";

/** The three types Workiz offers in "Add Custom fields", in its order and words. */
export const ITEM_ATTRIBUTE_TYPE_OPTIONS: { value: ItemAttributeType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "quantity", label: "Quantity based number" },
];

/** Workiz types a Number / Quantity field in as a number; the value is kept as text. */
export function inputTypeFor(attribute: Pick<ItemAttribute, "type">): "text" | "number" {
  return attribute.type === "text" ? "text" : "number";
}

/** The Workiz rule, case-insensitive here: no two fields share a name. */
export function nameTaken(
  attributes: Pick<ItemAttribute, "id" | "name">[],
  name: string,
  exceptId?: string,
): boolean {
  const wanted = name.trim().toLowerCase();
  return attributes.some((a) => a.id !== exceptId && a.name.trim().toLowerCase() === wanted);
}

/**
 * What the item's Save sends for its custom fields: only the names whose value
 * changed — a new value, or `null` for one emptied. Names the catalog does not
 * know (an imported `workiz_attr_<id>`) are never sent, so they are kept.
 * `undefined` when nothing changed.
 */
export function customAttributesPatch(
  original: Record<string, string> | undefined,
  current: Record<string, string>,
  names: string[],
): Record<string, string | null> | undefined {
  const patch: Record<string, string | null> = {};
  for (const name of names) {
    const before = original?.[name] ?? "";
    const after = current[name] ?? "";
    if (before === after) continue;
    patch[name] = after.trim() === "" ? null : after;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * The item's values after a field is renamed: what the server did to every
 * stored item, done to the open form too, so a value typed but not yet saved
 * follows its field.
 */
export function renameValueKey(
  values: Record<string, string>,
  from: string,
  to: string,
): Record<string, string> {
  if (from === to || !(from in values)) return values;
  const { [from]: moved, ...rest } = values;
  return { ...rest, [to]: moved };
}
