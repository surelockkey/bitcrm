import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { ClientType, DealPriority, DealStage, DealStatus, type Deal } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { EditDealSheet } from "./edit-deal-sheet";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}));

const DEAL: Deal = {
  id: "deal-1",
  dealNumber: 42,
  contactId: "contact-1",
  clientType: ClientType.RESIDENTIAL,
  serviceArea: "Atlanta Metro",
  address: {
    street: "123 Peachtree St",
    city: "Atlanta",
    state: "GA",
    zip: "30303",
    lat: 33.749,
    lng: -84.388,
  },
  jobType: "lockout",
  stage: DealStage.NEW_LEAD,
  assignedDispatcherId: "dispatcher-1",
  priority: DealPriority.NORMAL,
  tags: [],
  status: DealStatus.ACTIVE,
  createdBy: "dispatcher-1",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:00.000Z",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Capture the body the sheet actually PUTs. */
function captureUpdate() {
  const sent: { body?: Record<string, unknown> } = {};
  server.use(
    http.put("*/deals/deal-1", async ({ request }) => {
      sent.body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ success: true, data: DEAL });
    }),
  );
  return sent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EditDealSheet", () => {
  /**
   * The dispatch map plots deals by address.lat/lng. The form rebuilt `address`
   * from its own fields and never carried the coordinates, and the backend writes
   * `address` as one whole object — so saving an untouched deal erased them and
   * the pin vanished from the map.
   */
  it("preserves the deal's coordinates when the address is not edited", async () => {
    const sent = captureUpdate();
    const user = userEvent.setup();

    render(<EditDealSheet deal={DEAL} open onOpenChange={() => {}} />, { wrapper });
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(sent.body).toBeDefined());
    expect(sent.body!.address).toMatchObject({
      street: "123 Peachtree St",
      lat: 33.749,
      lng: -84.388,
    });
  });

  it("drops stale coordinates when the address is edited", async () => {
    const sent = captureUpdate();
    const user = userEvent.setup();

    render(<EditDealSheet deal={DEAL} open onOpenChange={() => {}} />, { wrapper });

    const street = screen.getByPlaceholderText(/street/i);
    await user.clear(street);
    await user.type(street, "999 Somewhere Else Rd");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(sent.body).toBeDefined());
    const address = sent.body!.address as Record<string, unknown>;
    expect(address.street).toBe("999 Somewhere Else Rd");
    // Stale coords would put the pin at the old house; the backend re-geocodes
    // when they're absent.
    expect(address.lat).toBeUndefined();
    expect(address.lng).toBeUndefined();
  });
});
