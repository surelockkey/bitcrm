import { describe, it, expect } from "vitest";
import { customFieldFormSchema, toCustomFieldBody } from "./schemas";

describe("customFieldFormSchema", () => {
  it("requires at least one option for a dropdown", () => {
    const res = customFieldFormSchema.safeParse({
      name: "Lock Brand",
      type: "dropdown",
      options: [],
    });
    expect(res.success).toBe(false);
  });

  it("requires at least one option for a multi_select", () => {
    const res = customFieldFormSchema.safeParse({
      name: "Add-ons",
      type: "multi_select",
      options: [],
    });
    expect(res.success).toBe(false);
  });

  it("accepts a dropdown with options", () => {
    const res = customFieldFormSchema.safeParse({
      name: "Lock Brand",
      type: "dropdown",
      options: ["Kwikset", "Schlage"],
    });
    expect(res.success).toBe(true);
  });

  it("strips options for a non-option type", () => {
    const parsed = customFieldFormSchema.parse({
      name: "Notes",
      type: "text",
      options: ["should", "be", "dropped"],
    });
    expect(parsed.options).toEqual([]);
  });

  it("rejects a junk type", () => {
    const res = customFieldFormSchema.safeParse({ name: "X", type: "wormhole" });
    expect(res.success).toBe(false);
  });

  it("applies defaults", () => {
    const parsed = customFieldFormSchema.parse({ name: "Notes", type: "text" });
    expect(parsed.group).toBe("");
    expect(parsed.options).toEqual([]);
    expect(parsed.jobTypeIds).toEqual([]);
    expect(parsed.required).toBe(false);
    expect(parsed.requiredToClose).toBe(false);
    expect(parsed.searchable).toBe(false);
    expect(parsed.priority).toBe(0);
    expect(parsed.active).toBe(true);
  });

  it("maps a valid payload through toCustomFieldBody", () => {
    const parsed = customFieldFormSchema.parse({
      name: "Lock Brand",
      type: "dropdown",
      group: "Hardware",
      options: ["Kwikset", "Schlage"],
      jobTypeIds: ["jt-1"],
      required: true,
      requiredToClose: false,
      searchable: true,
      priority: "2",
      active: true,
    });
    expect(toCustomFieldBody(parsed)).toEqual({
      name: "Lock Brand",
      type: "dropdown",
      group: "Hardware",
      options: ["Kwikset", "Schlage"],
      jobTypeIds: ["jt-1"],
      required: true,
      requiredToClose: false,
      searchable: true,
      priority: 2,
      active: true,
    });
  });
});
