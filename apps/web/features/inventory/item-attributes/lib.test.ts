import { describe, expect, it } from "vitest";
import {
  ITEM_ATTRIBUTE_TYPE_OPTIONS,
  customAttributesPatch,
  inputTypeFor,
  nameTaken,
  renameValueKey,
} from "./lib";

describe("item-attributes lib", () => {
  it("offers Workiz's three types in its words", () => {
    expect(ITEM_ATTRIBUTE_TYPE_OPTIONS.map((o) => o.label)).toEqual(["Text", "Number", "Quantity based number"]);
  });

  it("types a Number / Quantity field in as a number", () => {
    expect(inputTypeFor({ type: "text" })).toBe("text");
    expect(inputTypeFor({ type: "number" })).toBe("number");
    expect(inputTypeFor({ type: "quantity" })).toBe("number");
  });

  it("a name is taken case-insensitively, the field itself excepted", () => {
    const list = [
      { id: "a", name: "Link_UHS" },
      { id: "b", name: "SKU_CRM" },
    ];
    expect(nameTaken(list, " link_uhs ")).toBe(true);
    expect(nameTaken(list, "LINK_UHS", "a")).toBe(false);
    expect(nameTaken(list, "Bin")).toBe(false);
  });

  it("the patch names only changed catalog fields; an emptied one is null", () => {
    expect(
      customAttributesPatch(
        { Link_UHS: "u", SKU_CRM: "c", workiz_attr_1: "keep" },
        { Link_UHS: "u2", SKU_CRM: "", workiz_attr_1: "changed?", "ALL SKU": "" },
        ["ALL SKU", "Link_UHS", "SKU_CRM"],
      ),
    ).toEqual({ Link_UHS: "u2", SKU_CRM: null });
    expect(customAttributesPatch({ Link_UHS: "u" }, { Link_UHS: "u" }, ["Link_UHS"])).toBeUndefined();
  });

  it("a renamed field takes its value along", () => {
    expect(renameValueKey({ a: "1", b: "2" }, "a", "A")).toEqual({ b: "2", A: "1" });
    const same = { a: "1" };
    expect(renameValueKey(same, "x", "y")).toBe(same);
  });
});
