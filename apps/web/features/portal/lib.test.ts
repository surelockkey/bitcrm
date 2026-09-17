import { describe, expect, it } from "vitest";
import type { PortalView } from "@bitcrm/types";
import {
  businessAddressLine,
  isInvalidPortalError,
  portalGreeting,
  portalPdfPath,
  telHref,
  unwrapEnvelope,
} from "./lib";
import { PublicApiError } from "./public-http";

const view = {
  business: { name: "Acme Locks", phone: "+14045550100" },
  client: { firstName: "Jane", lastName: "Smith" },
  estimates: [],
  invoices: [],
  preview: false,
} as PortalView;

describe("portal lib", () => {
  it("greets the client by first name", () => {
    expect(portalGreeting(view)).toBe("Hi Jane, here are your documents from Acme Locks");
    expect(portalGreeting({ ...view, client: { firstName: "", lastName: "" } })).toBe(
      "Hi there, here are your documents from Acme Locks",
    );
  });

  it("formats the business address on one line", () => {
    expect(businessAddressLine(undefined)).toBe("");
    expect(
      businessAddressLine({ street: "1 Main", unit: "Ste 2", city: "Phoenix", state: "AZ", zip: "85001" }),
    ).toBe("1 Main, Ste 2, Phoenix, AZ 85001");
  });

  it("builds tel: links from display numbers", () => {
    expect(telHref("(404) 555-0100")).toBe("tel:4045550100");
    expect(telHref("+1 404 555 0100")).toBe("tel:+14045550100");
  });

  it("builds the public pdf path with an encoded token", () => {
    expect(portalPdfPath("a/b", "invoice", "d1")).toBe("/billing/public/portal/a%2Fb/invoice/d1/pdf");
  });

  it("unwraps the API envelope", () => {
    expect(unwrapEnvelope({ success: true, data: { a: 1 } })).toEqual({ ok: true, data: { a: 1 } });
    expect(unwrapEnvelope({ success: false, error: { message: "Nope" } })).toEqual({ ok: false, message: "Nope" });
    expect(unwrapEnvelope(null)).toEqual({ ok: false, message: undefined });
  });

  it("treats 400/401/403/404/410 as an invalid link", () => {
    for (const s of [400, 401, 403, 404, 410]) expect(isInvalidPortalError(new PublicApiError(s, "x"))).toBe(true);
    expect(isInvalidPortalError(new PublicApiError(500, "x"))).toBe(false);
    expect(isInvalidPortalError(new PublicApiError(429, "x"))).toBe(false);
    expect(isInvalidPortalError(new Error("x"))).toBe(false);
  });
});
