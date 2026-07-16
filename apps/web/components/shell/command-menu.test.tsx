import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { CommandMenu } from "./command-menu";
import { useUiStore } from "@/stores/ui-store";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, isTechnician: false }),
}));

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(CommandMenu) as ReactNode,
    ),
  );
}

beforeEach(() => {
  push.mockClear();
  useUiStore.setState({ commandOpen: false });
});

describe("CommandMenu", () => {
  it("shows nav items (not a search) when the query is empty", () => {
    useUiStore.setState({ commandOpen: true });
    renderMenu();

    expect(
      screen.getByPlaceholderText(/search deals, contacts/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Deals")).toBeInTheDocument();
  });

  it("queries the backend and shows grouped entity results as you type", async () => {
    server.use(
      http.get("*/search", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("q")).toBe("acme");
        expect(url.searchParams.get("mode")).toBe("typeahead");
        return HttpResponse.json({
          success: true,
          data: {
            query: "acme",
            mode: "typeahead",
            took: 3,
            groups: [
              {
                type: "company",
                total: 1,
                items: [
                  {
                    entityId: "co1",
                    type: "company",
                    title: "Acme Corp",
                    subtitle: "acme.com",
                    badges: ["commercial"],
                    url: "/companies/co1",
                    score: 2,
                  },
                ],
              },
            ],
          },
        });
      }),
    );

    useUiStore.setState({ commandOpen: true });
    renderMenu();

    await userEvent.type(
      screen.getByPlaceholderText(/search deals, contacts/i),
      "acme",
    );

    // debounced request resolves → grouped result appears, nav is hidden
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Companies")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("navigates to the hit url on select", async () => {
    server.use(
      http.get("*/search", () =>
        HttpResponse.json({
          success: true,
          data: {
            query: "acme",
            mode: "typeahead",
            took: 1,
            groups: [
              {
                type: "company",
                total: 1,
                items: [
                  {
                    entityId: "co1",
                    type: "company",
                    title: "Acme Corp",
                    badges: [],
                    url: "/companies/co1",
                    score: 1,
                  },
                ],
              },
            ],
          },
        }),
      ),
    );

    useUiStore.setState({ commandOpen: true });
    renderMenu();

    await userEvent.type(
      screen.getByPlaceholderText(/search deals, contacts/i),
      "acme",
    );
    const hit = await screen.findByText("Acme Corp");
    await userEvent.click(hit);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/companies/co1"));
  });
});
