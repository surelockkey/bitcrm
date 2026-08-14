import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DialerDirectory } from "./dialer-directory";

vi.mock("@/features/clients/hooks", () => ({
  useContacts: () => ({
    data: [
      {
        id: "c1",
        firstName: "Jane",
        lastName: "Roe",
        phones: ["+14045551234"],
      },
      {
        id: "c2",
        firstName: "Peter",
        lastName: "Novak",
        phones: ["+380958601427"],
      },
    ],
  }),
  useCompanies: () => ({
    data: [{ id: "co1", title: "Acme Locks", phones: ["+14045559999"] }],
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      {
        id: "u9",
        name: "Tamir Levi",
        phone: "+15412830739",
        softphoneOnline: true,
      },
    ],
  }),
}));

describe("DialerDirectory", () => {
  it("stays out of the way until there's something to match", () => {
    const { container } = render(<DialerDirectory query="a" onPick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("matches a client by name and hands back the number to dial", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<DialerDirectory query="jane" onPick={onPick} />);

    await user.click(screen.getByRole("button", { name: /Jane Roe/ }));
    expect(onPick).toHaveBeenCalledWith("+14045551234");
  });

  it("matches on digits however the number is written", () => {
    render(<DialerDirectory query="404 555 12" onPick={vi.fn()} />);
    expect(screen.getByText("Jane Roe")).toBeInTheDocument();
    // Not the company on 404 555 9999.
    expect(screen.queryByText("Acme Locks")).not.toBeInTheDocument();
  });

  it("finds company main lines and teammates, not just clients", () => {
    render(<DialerDirectory query="acme" onPick={vi.fn()} />);
    expect(screen.getByText("Acme Locks")).toBeInTheDocument();

    render(<DialerDirectory query="tamir" onPick={vi.fn()} />);
    expect(screen.getByText("Tamir Levi")).toBeInTheDocument();
    expect(screen.getByText(/Teammate/)).toBeInTheDocument();
  });

  it("says so when nothing matches, without blocking the dial", () => {
    render(<DialerDirectory query="zzzz" onPick={vi.fn()} />);
    expect(screen.getByText(/can still be dialled/i)).toBeInTheDocument();
  });
});
