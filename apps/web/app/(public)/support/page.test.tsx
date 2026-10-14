import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SupportPage, { metadata } from "./page";
import { PRIVACY_CONTACT_EMAIL, COMPANY_LEGAL_NAME } from "../privacy/policy";

/**
 * App Store Connect wants a public Support URL next to the privacy policy.
 * This page is it: who the app is for, how to get help, and the one mailbox —
 * the same one the privacy policy names, so a reader reaches one place.
 */
describe("Support page", () => {
  it("is titled, names the company and links the support mailbox", () => {
    render(<SupportPage />);
    expect(screen.getByRole("heading", { level: 1, name: "BitCRM Support" })).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(COMPANY_LEGAL_NAME)).length).toBeGreaterThan(0);
    const mail = screen.getByRole("link", { name: PRIVACY_CONTACT_EMAIL });
    expect(mail).toHaveAttribute("href", `mailto:${PRIVACY_CONTACT_EMAIL}`);
  });

  it("tells a technician how to sign in and links the privacy policy", () => {
    const { container } = render(<SupportPage />);
    expect(container.textContent).toMatch(/no public sign-up/i);
    expect(screen.getByRole("link", { name: /privacy policy/i })).toHaveAttribute("href", "/privacy");
  });

  it("carries a page title", () => {
    expect(String(metadata.title)).toMatch(/Support/);
  });
});
