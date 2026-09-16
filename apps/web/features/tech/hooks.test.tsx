import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import {
  ClientType,
  DealPriority,
  DealStatus,
  JobSuperStatus,
  type Deal,
} from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import {
  currentPosition,
  MAX_REPORTED_ACCURACY_M,
  useConfirmReceipt,
  useMarkArrived,
  useMyJobs,
  useOnMyWay,
  useRunningLate,
} from "./hooks";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const me = vi.hoisted(() => ({ value: { data: { id: "t1" } } as { data?: { id: string } } }));
vi.mock("@/features/auth/use-me", () => ({ useMe: () => me.value }));

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "QueryWrapper";
  return Wrapper;
}

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    dealNumber: "A1B2C3",
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "CT",
    address: { street: "1 Main St", city: "Hartford", state: "CT", zip: "06103" },
    jobTypeId: "jt1",
    superStatus: JobSuperStatus.SUBMITTED,
    assignedTechIds: ["t1"],
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

beforeEach(() => {
  toast.error.mockClear();
  toast.success.mockClear();
  me.value = { data: { id: "t1" } };
});

describe("useMyJobs", () => {
  it("asks only for the signed-in technician's jobs, and groups them by day", async () => {
    const seen: string[] = [];
    server.use(
      http.get("*/deals", ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("techId") ?? "");
        return HttpResponse.json({
          success: true,
          data: [deal({ id: "a", scheduledDate: "2026-09-16", scheduledTimeSlot: "09:00-10:00" })],
          pagination: { nextCursor: undefined, count: 1 },
        });
      }),
    );

    const { result } = renderHook(() => useMyJobs("2026-09-16"), { wrapper: wrapper(newClient()) });

    await waitFor(() => expect(result.current.groups[0]?.deals).toHaveLength(1));
    expect(seen).toEqual(["t1"]);
    expect(result.current.groups[0].key).toBe("today");
    expect(result.current.ready).toBe(true);
  });

  it("asks for nothing at all until the signed-in id resolves", async () => {
    let called = false;
    server.use(
      http.get("*/deals", () => {
        called = true;
        return HttpResponse.json({ success: true, data: [], pagination: { count: 0 } });
      }),
    );
    me.value = { data: undefined };

    const { result } = renderHook(() => useMyJobs("2026-09-16"), { wrapper: wrapper(newClient()) });

    await new Promise((r) => setTimeout(r, 30));
    expect(called).toBe(false);
    expect(result.current.ready).toBe(false);
  });
});

describe("technician actions", () => {
  it("paints the confirmation on the cached job before the server answers", async () => {
    server.use(
      http.post("*/deals/d1/tech/confirm", () =>
        HttpResponse.json({ success: true, data: deal({ techConfirmedAt: "2026-09-16T10:00:00Z" }) }),
      ),
    );
    const client = newClient();
    client.setQueryData(queryKeys.deals.detail("d1"), deal());

    const { result } = renderHook(() => useConfirmReceipt("d1"), { wrapper: wrapper(client) });
    result.current.mutate();

    await waitFor(() => {
      const cached = client.getQueryData<Deal>(queryKeys.deals.detail("d1"));
      expect(cached?.techConfirmedAt).toBeTruthy();
      expect(cached?.techConfirmedBy).toBe("t1");
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Job confirmed"));
  });

  it("rolls the arrival back and says why when the server refuses", async () => {
    server.use(
      http.post("*/deals/d1/tech/arrived", () =>
        HttpResponse.json(
          { success: false, message: "Only a technician assigned to this job can do that" },
          { status: 403 },
        ),
      ),
    );
    const client = newClient();
    client.setQueryData(queryKeys.deals.detail("d1"), deal());

    const { result } = renderHook(() => useMarkArrived("d1"), { wrapper: wrapper(client) });
    result.current.mutate({ lat: 1, lng: 2 });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(client.getQueryData<Deal>(queryKeys.deals.detail("d1"))?.arrivedAt).toBeUndefined();
  });
});

describe("the client texts", () => {
  /** Collects what the hook actually posted to an automation endpoint. */
  function recorder(path: string) {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post(path, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ success: true, data: { id: `m${bodies.length}` } }, { status: 202 });
      }),
    );
    return bodies;
  }

  it("gives every 'Running late' tap its own idempotency key, so a later ETA is not swallowed", async () => {
    const bodies = recorder("*/messaging/automations/late");
    const { result } = renderHook(() => useRunningLate("d1"), { wrapper: wrapper(newClient()) });

    // 10:02 "15 minutes", then 10:07 "45 minutes": same job, same technician,
    // same 15-minute window — the server's fallback dedup key cannot tell them
    // apart, so the second text would be accepted and never sent.
    result.current.mutate(15);
    await waitFor(() => expect(bodies).toHaveLength(1));
    result.current.mutate(45);
    await waitFor(() => expect(bodies).toHaveLength(2));

    expect(bodies.map((b) => b.minutes)).toEqual([15, 45]);
    expect(bodies[0].clientMessageId).toEqual(expect.any(String));
    expect(bodies[1].clientMessageId).not.toBe(bodies[0].clientMessageId);
  });

  it("gives every 'On my way' tap its own idempotency key too", async () => {
    const bodies = recorder("*/messaging/automations/on-my-way");
    const { result } = renderHook(() => useOnMyWay("d1"), { wrapper: wrapper(newClient()) });

    result.current.mutate(undefined);
    await waitFor(() => expect(bodies).toHaveLength(1));
    result.current.mutate(20);
    await waitFor(() => expect(bodies).toHaveLength(2));

    expect(bodies[1].etaMinutes).toBe(20);
    expect(bodies[0].clientMessageId).toEqual(expect.any(String));
    expect(bodies[1].clientMessageId).not.toBe(bodies[0].clientMessageId);
  });
});

describe("currentPosition", () => {
  it("resolves to nothing rather than hanging when the browser has no geolocation", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });

    await expect(currentPosition()).resolves.toBeUndefined();

    if (original) Object.defineProperty(navigator, "geolocation", original);
  });

  it("resolves to nothing when the technician declines the permission", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: (_ok: unknown, fail: () => void) => fail() },
      configurable: true,
    });

    await expect(currentPosition()).resolves.toBeUndefined();

    if (original) Object.defineProperty(navigator, "geolocation", original);
  });

  it("passes the fix through when the phone gives one", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok: (p: unknown) => void) =>
          ok({ coords: { latitude: 41.76, longitude: -72.67, accuracy: 9 } }),
      },
      configurable: true,
    });

    await expect(currentPosition()).resolves.toEqual({ lat: 41.76, lng: -72.67, accuracy: 9 });

    if (original) Object.defineProperty(navigator, "geolocation", original);
  });

  it("keeps the arrival but drops an accuracy the server would reject", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    Object.defineProperty(navigator, "geolocation", {
      value: {
        // A tablet in the van with no GPS: a network fix, accurate to 250 km.
        getCurrentPosition: (ok: (p: unknown) => void) =>
          ok({ coords: { latitude: 41.76, longitude: -72.67, accuracy: 250_000 } }),
      },
      configurable: true,
    });

    // The whole POST would 400 on the DTO's @Max and the arrival would be lost;
    // the coordinates are what matter, so only the annotation is dropped.
    await expect(currentPosition()).resolves.toEqual({ lat: 41.76, lng: -72.67 });
    // The cap is the server's: MarkArrivedDto.accuracy @Max(100000).
    expect(MAX_REPORTED_ACCURACY_M).toBe(100_000);

    if (original) Object.defineProperty(navigator, "geolocation", original);
  });

  it("keeps a fix sitting exactly on the cap", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok: (p: unknown) => void) =>
          ok({ coords: { latitude: 41.76, longitude: -72.67, accuracy: 100_000 } }),
      },
      configurable: true,
    });

    await expect(currentPosition()).resolves.toEqual({
      lat: 41.76,
      lng: -72.67,
      accuracy: 100_000,
    });

    if (original) Object.defineProperty(navigator, "geolocation", original);
  });
});
