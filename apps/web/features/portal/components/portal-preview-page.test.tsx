import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { PortalView } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));

import { PortalPreviewPage } from "./portal-preview-page";

const invoice = (id: string, number: string, date: string) => ({
  kind: "invoice" as const, id, number, date, status: "due" as const, total: 10, balanceDue: 10, sent: false,
});
const view: PortalView = {
  business: { name: "Sure Lock Key" },
  client: { firstName: "Jane", lastName: "Client" },
  invoices: [invoice("d2", "1042", "2026-09-02")],
  estimates: [],
  proposals: [],
  jobs: [],
  payments: [],
  preview: true,
  inbox: { total: 2, nextCursor: "cur-1" },
};

describe("PortalPreviewPage — the paged inbox", () => {
  it("Load more reads the next page of the preview, unsent documents and all", async () => {
    let asked = "";
    server.use(
      http.get("*/billing/portal-links/c1/preview", () => HttpResponse.json({ success: true, data: view })),
      http.get("*/billing/portal-links/c1/preview/inbox", ({ request }) => {
        asked = new URL(request.url).search;
        return HttpResponse.json({
          success: true,
          data: { invoices: [invoice("d1", "1041", "2026-09-01")], estimates: [], proposals: [], inbox: { total: 2 } },
        });
      }),
    );
    renderWithClient(<PortalPreviewPage contactId="c1" />);
    expect(await screen.findByRole("heading", { name: "Your Inbox (2)" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("button", { name: "Invoice #1041" })).toBeInTheDocument();
    expect(asked).toBe("?cursor=cur-1");
  });
});
