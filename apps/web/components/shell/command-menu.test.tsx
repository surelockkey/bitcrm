import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommandMenu } from "./command-menu";
import { useUiStore } from "@/stores/ui-store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, isTechnician: false }),
}));

beforeEach(() => {
  useUiStore.setState({ commandOpen: false });
});

describe("CommandMenu", () => {
  it("renders the search input and nav items when open (cmdk context present)", () => {
    useUiStore.setState({ commandOpen: true });
    render(<CommandMenu />);

    expect(screen.getByPlaceholderText(/search pages/i)).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Deals")).toBeInTheDocument();
  });
});
