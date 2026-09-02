import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobDialCard } from "./job-dial-card";

const mocks = vi.hoisted(() => ({
  code: { data: { code: "4729" }, isError: false } as Record<string, unknown>,
  can: vi.fn(() => true),
  config: { data: { technicianLine: "+14045550140" }, isError: false, isLoading: false } as Record<string, unknown>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => mocks.code,
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: mocks.can }),
}));
vi.mock("../config-hooks", () => ({
  useTelephonyConfig: () => mocks.config,
}));

describe("JobDialCard", () => {
  beforeEach(() => {
    mocks.code = { data: { code: "4729" }, isError: false };
    mocks.can.mockReturnValue(true);
    mocks.config = {
      data: { technicianLine: "+14045550140" },
      isError: false,
      isLoading: false,
    };
  });

  it("shows the shared line and the job code", () => {
    render(<JobDialCard dealId="deal-1" />);

    expect(screen.getByText(/\+1 \(404\) 555-0140/)).toBeInTheDocument();
    // Grouped in pairs — far easier to key at a customer's door.
    expect(screen.getByText("47 29")).toBeInTheDocument();
  });

  /**
   * The card is shown to masked users too: the code is what they get INSTEAD
   * of the number, and it is a routing key rather than a credential.
   */
  it("never shows the client's number", () => {
    render(<JobDialCard dealId="deal-1" />);

    expect(screen.queryByText(/555-1234/)).not.toBeInTheDocument();
  });

  /** One code, one confirmation, nothing to remember. */
  it("explains the sequence", () => {
    render(<JobDialCard dealId="deal-1" />);

    expect(screen.getByText(/confirm the client/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/PIN/i);
  });

  /**
   * This card used to return null whenever anything was missing, which is how
   * a workspace with no designated line ended up seeing NOTHING where the
   * dial-in was supposed to be — indistinguishable from the feature not
   * existing. An unconfigured feature has to say it is unconfigured.
   */
  describe("with no technician line designated", () => {
    beforeEach(() => {
      mocks.config = { data: { technicianLine: null }, isError: false, isLoading: false };
    });

    it("says the dial-in is not set up rather than disappearing", () => {
      render(<JobDialCard dealId="deal-1" />);

      expect(screen.getByText(/not set up/i)).toBeInTheDocument();
    });

    it("tells somebody who can fix it where to go", () => {
      render(<JobDialCard dealId="deal-1" />);

      expect(screen.getByText(/phone numbers/i)).toBeInTheDocument();
    });

    /** A technician cannot designate a line; sending them to a settings page
     *  they cannot open would only waste their time. */
    it("points everybody else at the office instead", () => {
      mocks.can.mockReturnValue(false);

      render(<JobDialCard dealId="deal-1" />);

      expect(screen.getByText(/office|dispatch/i)).toBeInTheDocument();
      expect(screen.queryByText(/settings/i)).not.toBeInTheDocument();
    });

    /** There is no code to key without a line to key it into. */
    it("does not show a job code nobody can use", () => {
      render(<JobDialCard dealId="deal-1" />);

      expect(screen.queryByText("47 29")).not.toBeInTheDocument();
    });
  });

  /**
   * The number to dial is still worth showing when only the code is missing —
   * and the reason it is missing has to be visible, because a technician
   * staring at a blank space cannot tell a broken mint from an empty feature.
   */
  it("keeps the line on screen when the code could not be minted", () => {
    mocks.code = { data: undefined, isError: true };

    render(<JobDialCard dealId="deal-1" />);

    expect(screen.getByText(/\+1 \(404\) 555-0140/)).toBeInTheDocument();
    expect(screen.getByText(/could not be issued|unavailable/i)).toBeInTheDocument();
  });

  /**
   * "Nobody has set this up" and "we could not ask" look identical on screen
   * and need completely different actions — telling a technician to chase the
   * office over a failed request sends them down the wrong path entirely.
   */
  it("distinguishes a failed settings load from an unconfigured one", () => {
    mocks.config = { data: undefined, isError: true, isLoading: false };

    render(<JobDialCard dealId="deal-1" />);

    expect(screen.getByText(/could not load|try again/i)).toBeInTheDocument();
    expect(screen.queryByText(/not set up/i)).not.toBeInTheDocument();
  });

  it("says nothing at all while the settings are still loading", () => {
    mocks.config = { data: undefined, isError: false, isLoading: true };

    const { container } = render(<JobDialCard dealId="deal-1" />);

    expect(container).toBeEmptyDOMElement();
  });
});
