import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CallPartyCell } from "./call-party-cell";

const can = vi.fn(() => true);
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (...args: unknown[]) => can(...(args as [])) }),
}));
vi.mock("@/features/users/hooks", () => ({
  useRoles: () => ({ data: [{ id: "role-dispatcher", name: "Dispatcher" }] }),
}));

describe("CallPartyCell", () => {
  describe("one of our users", () => {
    it("leads with the name, linked, with their role and number", () => {
      render(
        <CallPartyCell
          party={{
            kind: "user",
            id: "u1",
            roleId: "role-dispatcher",
            name: "Nazarii",
            number: "+12624061115",
          }}
        />,
      );
      expect(screen.getByRole("link", { name: "Nazarii" })).toHaveAttribute(
        "href",
        "/admin/users?user=u1",
      );
      expect(screen.getByText("Dispatcher")).toBeInTheDocument();
      expect(screen.getByText("(262) 406-1115")).toBeInTheDocument();
    });

    it("still marks them as ours when the role is unresolved", () => {
      render(
        <CallPartyCell party={{ kind: "user", id: "u1", name: "Nazarii" }} />,
      );
      expect(screen.getByText("Team")).toBeInTheDocument();
    });

    it("drops the link for viewers who can't open users", () => {
      can.mockReturnValueOnce(false);
      render(
        <CallPartyCell party={{ kind: "user", id: "u1", name: "Nazarii" }} />,
      );
      expect(screen.getByText("Nazarii")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("marks a call that reached their own phone", () => {
      render(
        <CallPartyCell
          party={{
            kind: "user",
            id: "u9",
            roleId: "role-dispatcher",
            personal: true,
            name: "Tamir Levi",
            number: "+15412830739",
          }}
        />,
      );
      expect(screen.getByText("Tamir Levi")).toBeInTheDocument();
      expect(screen.getByText("Dispatcher")).toBeInTheDocument();
      expect(screen.getByText(/personal/)).toBeInTheDocument();
    });

    it("doesn't call a softphone leg personal", () => {
      render(
        <CallPartyCell
          party={{
            kind: "user",
            id: "u1",
            name: "Nazarii",
            number: "+12624061115",
          }}
        />,
      );
      expect(screen.queryByText(/personal/)).not.toBeInTheDocument();
    });

    it("doesn't repeat a legacy client: leg as a number", () => {
      render(
        <CallPartyCell
          party={{ kind: "user", id: "u1", name: "Nazarii", number: "client:u1" }}
        />,
      );
      expect(screen.queryByText("Agent")).not.toBeInTheDocument();
    });
  });

  describe("a known client", () => {
    it("links to the client record, not to a user", () => {
      render(
        <CallPartyCell
          party={{
            kind: "contact",
            id: "c1",
            name: "Jane Roe",
            number: "+380958601427",
          }}
        />,
      );
      expect(screen.getByRole("link", { name: "Jane Roe" })).toHaveAttribute(
        "href",
        "/contacts/c1",
      );
      expect(screen.getByText("+380 95 860 1427")).toBeInTheDocument();
      // Clients are not staff — no role badge.
      expect(screen.queryByText("Team")).not.toBeInTheDocument();
    });
  });

  describe("an unknown caller", () => {
    it("offers to create a client, passing the raw number", async () => {
      const user = userEvent.setup();
      const onAddClient = vi.fn();
      render(
        <CallPartyCell
          party={{ kind: "unknown", number: "+380958601427" }}
          onAddClient={onAddClient}
        />,
      );
      expect(screen.getByText("+380 95 860 1427")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /add client/i }));
      expect(onAddClient).toHaveBeenCalledWith("+380958601427");
    });

    it("hides the shortcut without permission to create contacts", () => {
      can.mockReturnValueOnce(false);
      render(
        <CallPartyCell
          party={{ kind: "unknown", number: "+380958601427" }}
          onAddClient={vi.fn()}
        />,
      );
      expect(
        screen.queryByRole("button", { name: /add client/i }),
      ).not.toBeInTheDocument();
    });

    it("hides the shortcut where there's no handler (e.g. a client: leg)", () => {
      render(<CallPartyCell party={{ kind: "unknown", number: "client:u1" }} />);
      expect(
        screen.queryByRole("button", { name: /add client/i }),
      ).not.toBeInTheDocument();
    });
  });
});
