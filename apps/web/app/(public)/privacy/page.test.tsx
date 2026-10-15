import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PrivacyPolicyPage, { metadata } from "./page";
import { COMPANY_LEGAL_NAME, EFFECTIVE_DATE, PRIVACY_CONTACT_EMAIL, SECTIONS } from "./policy";

/**
 * The App Store listing needs a public privacy policy URL, and App Review
 * reads it against the app's permission strings and privacy labels. This page
 * is that URL: static, outside the signed-in shell, and saying the same thing
 * the app does about location, photos and card data.
 */
describe("Privacy Policy page", () => {
  it("is titled and dated, and names who it is from and how to reach them", () => {
    render(<PrivacyPolicyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
    expect(screen.getByText(`Effective ${EFFECTIVE_DATE}`)).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(COMPANY_LEGAL_NAME)).length).toBeGreaterThan(0);
    const mail = screen.getByRole("link", { name: PRIVACY_CONTACT_EMAIL });
    expect(mail).toHaveAttribute("href", `mailto:${PRIVACY_CONTACT_EMAIL}`);
  });

  it("renders every section of the policy under its own heading", () => {
    render(<PrivacyPolicyPage />);
    for (const section of SECTIONS) {
      expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeInTheDocument();
    }
    expect(SECTIONS.length).toBeGreaterThanOrEqual(8);
  });

  // What the page promises must match the app (2026-10-15): position for
  // dispatch while the app is open and, with "Always", during working hours in
  // the background; where each job update happened; Tap to Pay; the switch.
  it("says when location is shared, in the background too, what is kept, and how to turn it off", () => {
    const { container } = render(<PrivacyPolicyPage />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/while the app is open/i);
    expect(text).toMatch(/working hours/i);
    expect(text).toMatch(/background or closed/i);
    expect(text).toMatch(/Always/);
    expect(text).toMatch(/job update/i);
    expect(text).toMatch(/7 days/);
    expect(text).toMatch(/blue location indicator/i);
    expect(text).toMatch(/Share my location with dispatch/);
    expect(text).toMatch(/Tap to Pay/);
    expect(text).toMatch(/subcontractor/i);
    expect(text).not.toMatch(/never .{0,40}in the background/i);
  });

  it("says card data goes to Stripe and is never stored by us, and that nothing is sold or used for ads", () => {
    const { container } = render(<PrivacyPolicyPage />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Stripe/);
    expect(text).toMatch(/never (see|store|stored|receive)[^.]{0,80}card number/i);
    expect(text).toMatch(/do(es)? not sell/i);
    expect(text).toMatch(/advertis/i);
  });

  it("carries a page title for the browser tab and search results", () => {
    expect(String(metadata.title)).toMatch(/Privacy Policy/);
  });
});
