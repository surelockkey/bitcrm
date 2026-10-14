import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { ContactSource, ContactType, CrmStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { useContactByPhone } from "./hooks";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return Wrapper;
}

const OWNER = {
  id: "c1",
  firstName: "Ann",
  lastName: "Rice",
  phones: ["+18605550142"],
  emails: [],
  addresses: [],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.MANUAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

/** Every by-phone lookup the hook sends, by the number it asked about. */
function listen(): string[] {
  const asked: string[] = [];
  server.use(
    http.get("*/crm/contacts/search/by-phone", ({ request }) => {
      const phone = new URL(request.url).searchParams.get("phone") ?? "";
      asked.push(phone);
      // The API refuses anything short of a real number with 400 "Invalid phone number".
      if (phone !== "+18605550142") return HttpResponse.json({ success: false, message: "Invalid phone number" }, { status: 400 });
      return HttpResponse.json({ success: true, data: OWNER });
    }),
  );
  return asked;
}

const rest = () => new Promise((r) => setTimeout(r, 450));

/**
 * The Add Client form asks whether a number already belongs to somebody as
 * it is typed. QA 2026-10-14 #17: a 7-digit number in progress went out as
 * `+15550142` and the API answered 400 on every keystroke.
 */
describe("useContactByPhone — the Add Client dedup lookup", () => {
  it("asks nothing while the number is still being typed", async () => {
    const asked = listen();
    const { result } = renderHook(() => useContactByPhone("+15550142", true), { wrapper: wrapper() });
    await rest();
    expect(asked).toEqual([]);
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("asks once, for the complete number, after the typing has rested", async () => {
    const asked = listen();
    const { result, rerender } = renderHook(({ phone }) => useContactByPhone(phone, true), {
      wrapper: wrapper(),
      initialProps: { phone: "+1860555" },
    });
    rerender({ phone: "+186055501" });
    rerender({ phone: "+1860555014" });
    rerender({ phone: "+18605550142" });
    await waitFor(() => expect(result.current.data).toEqual(OWNER));
    expect(asked).toEqual(["+18605550142"]);
  });

  it("asks nothing when the caller has switched it off, complete number or not", async () => {
    const asked = listen();
    renderHook(() => useContactByPhone("+18605550142", false), { wrapper: wrapper() });
    await rest();
    expect(asked).toEqual([]);
  });
});
