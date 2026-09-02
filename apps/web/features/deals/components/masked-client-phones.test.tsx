import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MaskedClientPhones } from "./masked-client-phones";

vi.mock("@/features/telephony/components/call-client-button", () => ({
  CallClientButton: ({ phoneIndex, variant }: { phoneIndex?: number; variant?: string }) => (
    <button type="button" aria-label={`Call number ${phoneIndex}`} data-variant={variant} />
  ),
}));

/**
 * The regression this exists for: the call button used to live INSIDE a loop
 * over `contact.phones`, which is empty for a masked viewer — so a technician
 * saw "1 number, hidden" and had no way to place the call at all.
 */
describe("MaskedClientPhones", () => {
  it("offers a call button even though there is no number to show", () => {
    render(
      <MaskedClientPhones phoneCount={1} dealId="deal-1" contactId="contact-1" />,
    );

    expect(screen.getByRole("button", { name: /call number 0/i })).toBeInTheDocument();
    expect(screen.getByText(/number hidden/i)).toBeInTheDocument();
  });

  /** They cannot see the digits, but they can still pick the mobile. */
  it("gives every withheld number its own button and index", () => {
    render(
      <MaskedClientPhones phoneCount={3} dealId="deal-1" contactId="contact-1" />,
    );

    expect(screen.getByRole("button", { name: /call number 0/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /call number 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /call number 2/i })).toBeInTheDocument();
  });

  it("numbers the rows so two clients' numbers are distinguishable", () => {
    render(
      <MaskedClientPhones phoneCount={2} dealId="deal-1" contactId="contact-1" />,
    );

    expect(screen.getByText(/number 1 of 2, hidden/i)).toBeInTheDocument();
    expect(screen.getByText(/number 2 of 2, hidden/i)).toBeInTheDocument();
  });

  it("marks the primary when there is more than one", () => {
    render(
      <MaskedClientPhones phoneCount={2} dealId="deal-1" contactId="contact-1" />,
    );
    expect(screen.getByText(/primary/i)).toBeInTheDocument();
  });

  /**
   * This row is a technician's only route to the client — the digits are gone
   * — so the call is the row's whole purpose, not an afterthought hanging off
   * the end of a label.
   */
  it("gives the call the weight of the row, not a bare glyph", () => {
    render(
      <MaskedClientPhones phoneCount={1} dealId="deal-1" contactId="contact-1" />,
    );

    expect(screen.getByRole("button", { name: /call number 0/i })).toHaveAttribute(
      "data-variant",
      "prominent",
    );
  });

  it("renders nothing when the client genuinely has no number", () => {
    const { container } = render(
      <MaskedClientPhones phoneCount={0} dealId="deal-1" contactId="contact-1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("never renders a phone number", () => {
    render(
      <MaskedClientPhones phoneCount={2} dealId="deal-1" contactId="contact-1" />,
    );
    expect(document.body.textContent).not.toMatch(/\d{3}[-.\s]?\d{4}/);
  });
});
