import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MaskedClientPhones } from "./masked-client-phones";

vi.mock("@/features/telephony/components/call-client-button", () => ({
  CallClientButton: ({ phoneIndex, variant }: { phoneIndex?: number; variant?: string }) => (
    <button type="button" aria-label={`Call number ${phoneIndex}`} data-variant={variant} />
  ),
}));
// The masked number has its own tests; here it only says which number it is for.
vi.mock("@/features/telephony/components/job-dial-card", () => ({
  JobDialCard: ({ phoneIndex }: { phoneIndex?: number }) => <div data-testid={`dial-in-${phoneIndex ?? 0}`} />,
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
   * — so it is drawn exactly where a visible number would be: the job page's
   * Phone box, with the same handset inside it (job_b_01_details).
   */
  it("draws each hidden number as the Phone box, the call inside it", () => {
    const { container } = render(
      <MaskedClientPhones phoneCount={1} dealId="deal-1" contactId="contact-1" />,
    );

    const row = container.querySelector("[data-slot='masked-phone']");
    expect(row).toHaveTextContent(/^Phone/);
    expect(row).toContainElement(screen.getByRole("button", { name: /call number 0/i }));
    expect(screen.getByRole("button", { name: /call number 0/i })).toHaveAttribute("data-variant", "workiz");
  });

  it("renders nothing when the client genuinely has no number", () => {
    const { container } = render(
      <MaskedClientPhones phoneCount={0} dealId="deal-1" contactId="contact-1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  /** Workiz style: each hidden number has its own masked number under it. */
  it("draws a masked number under every hidden number", () => {
    render(<MaskedClientPhones phoneCount={2} dealId="deal-1" contactId="contact-1" />);

    expect(screen.getByTestId("dial-in-0")).toBeInTheDocument();
    expect(screen.getByTestId("dial-in-1")).toBeInTheDocument();
  });

  /** The extension is not a secret — the number is — so the row says what will be pressed. */
  it("shows each number's extension, by position", () => {
    render(
      <MaskedClientPhones
        phoneCount={2}
        extensions={["", "102"]}
        dealId="deal-1"
        contactId="contact-1"
      />,
    );

    const rows = document.querySelectorAll("[data-slot='masked-phone']");
    expect(rows[0]).not.toHaveTextContent(/ext/);
    expect(rows[1]).toHaveTextContent("Number 2 of 2, hidden · ext 102");
  });

  it("never renders a phone number", () => {
    render(
      <MaskedClientPhones phoneCount={2} dealId="deal-1" contactId="contact-1" />,
    );
    expect(document.body.textContent).not.toMatch(/\d{3}[-.\s]?\d{4}/);
  });
});
