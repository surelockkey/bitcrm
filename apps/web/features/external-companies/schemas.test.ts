import { describe, it, expect } from "vitest";
import { externalCompanyFormSchema, toExternalCompanyBody } from "./schemas";

describe("externalCompanyFormSchema", () => {
  it("accepts a full company and trims every field", () => {
    const parsed = externalCompanyFormSchema.parse({
      name: "  Allied Dispatch Solutions ",
      email: " Tammy.Killen@allieddispatch.com ",
      address: " 500 Borla Dr, Johnson City, TN 37604 ",
      phone: " (855) 281-0219 ",
      active: false,
    });
    expect(parsed).toEqual({
      name: "Allied Dispatch Solutions",
      email: "Tammy.Killen@allieddispatch.com",
      address: "500 Borla Dr, Johnson City, TN 37604",
      phone: "(855) 281-0219",
      active: false,
    });
  });

  it("requires only the name — the rest of the list has blanks", () => {
    const parsed = externalCompanyFormSchema.parse({ name: "Agero" });
    expect(parsed).toEqual({
      name: "Agero",
      email: "",
      address: "",
      phone: "",
      active: true,
    });
  });

  it("rejects an empty name", () => {
    expect(externalCompanyFormSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a malformed email but allows a blank one", () => {
    expect(externalCompanyFormSchema.safeParse({ name: "BNG", email: "nope" }).success).toBe(false);
    expect(externalCompanyFormSchema.safeParse({ name: "BNG", email: "" }).success).toBe(true);
  });

  it("maps to the request body, sending empty strings so fields can be cleared", () => {
    expect(
      toExternalCompanyBody({ name: "Yelp", email: "", address: "", phone: "", active: true }),
    ).toEqual({ name: "Yelp", email: "", address: "", phone: "", active: true });
  });
});
