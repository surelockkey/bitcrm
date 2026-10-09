import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import type { PaymentReportRow } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { getPaymentReportPage } from "./api";

/*
 * Workiz's Payments grid prints each client's phone (else email) under the
 * name (rep_payments_wz_01_default). The report's lines carry names only, so
 * a page of lines is fetched together with its clients — one answer, so the
 * rows never grow a line after they are on screen.
 */
const line = (id: string, contactId: string): PaymentReportRow => ({
  id,
  kind: "payment",
  paymentId: id,
  dealId: "d1",
  at: "2026-09-12T16:00:00.000Z",
  amount: 10,
  tip: 0,
  type: "cash",
  typeLabel: "Cash",
  contactId,
});

let asked: string[][] = [];

beforeEach(() => {
  asked = [];
  server.use(
    http.get("*/billing/payments/report", () =>
      HttpResponse.json({ success: true, data: { items: [line("p1", "c1"), line("p2", "c2"), line("p3", "c1")], nextCursor: "n" } }),
    ),
    http.post("*/crm/contacts/by-ids", async ({ request }) => {
      const { ids } = (await request.json()) as { ids: string[] };
      asked.push(ids);
      return HttpResponse.json({
        success: true,
        data: [
          { id: "c1", firstName: "A", lastName: "B", phones: ["4695000793", "2035550000"], emails: ["a@x.test"] },
          { id: "c2", firstName: "C", lastName: "D", phones: [], phonesMasked: true, phoneCount: 1, emails: ["c@x.test"] },
        ],
      });
    }),
  );
});

describe("getPaymentReportPage", () => {
  it("brings each client's first phone and email with the page, asking once per client", async () => {
    const page = await getPaymentReportPage({ dir: "desc", limit: 10 }, true);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBe("n");
    expect(asked).toEqual([["c1", "c2"]]);
    expect(page.clients).toEqual({
      c1: { phone: "4695000793", email: "a@x.test" },
      // Numbers hidden from this viewer: the email stands in, as in Workiz.
      c2: { email: "c@x.test" },
    });
  });

  it("does not ask for clients the viewer may not see", async () => {
    const page = await getPaymentReportPage({ dir: "desc", limit: 10 }, false);
    expect(asked).toEqual([]);
    expect(page.clients).toEqual({});
  });

  it("keeps the lines when the clients cannot be read", async () => {
    server.use(http.post("*/crm/contacts/by-ids", () => HttpResponse.json({ success: false, message: "Forbidden" }, { status: 403 })));
    const page = await getPaymentReportPage({ dir: "desc", limit: 10 }, true);
    expect(page.items).toHaveLength(3);
    expect(page.clients).toEqual({});
  });
});
