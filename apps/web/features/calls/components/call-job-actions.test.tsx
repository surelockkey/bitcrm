import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallRecord } from "../lib";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("./link-job-dialog", () => ({ LinkJobDialog: () => null }));

import { CallJobActions } from "./call-job-actions";

describe("CallJobActions", () => {
  it("creates a job prefilled with the call's client, source and company", async () => {
    const call = {
      callSid: "CA7",
      status: "in-progress",
      direction: "inbound",
      from: "+14045551234",
      to: "+15412830739",
      fromParty: { kind: "contact", id: "c9", name: "Jane" },
      sourceId: "src-1",
      businessProfileId: "bp-2",
      startedAt: "",
      updatedAt: "",
    } as unknown as CallRecord;
    render(<CallJobActions call={call} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /create job/i }));
    const href = push.mock.calls[0][0] as string;
    const qs = new URLSearchParams(href.split("?")[1]);
    expect(href.startsWith("/deals/new?")).toBe(true);
    expect(Object.fromEntries(qs)).toEqual({
      callSid: "CA7",
      contactId: "c9",
      sourceId: "src-1",
      companyId: "bp-2",
    });
  });
});
