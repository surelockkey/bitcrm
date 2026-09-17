import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ClientType,
  DealPriority,
  DealStatus,
  JobSuperStatus,
  type Deal,
} from "@bitcrm/types";
import type { DealAssignment } from "../api";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  settings: undefined as { sendToTechChannels?: ("sms" | "email" | "in_app")[] } | undefined,
  assignments: [] as DealAssignment[],
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, isTechnician: false }),
}));

vi.mock("@/features/messaging/hooks", () => ({
  useMessagingSettings: () => ({ data: mocks.settings }),
}));

vi.mock("../hooks", () => ({
  useSendToTech: () => ({ mutate: mocks.send, isPending: false }),
  useDealAssignments: () => ({ data: mocks.assignments }),
  useUserMap: () => ({
    map: new Map([["t1", { id: "t1", firstName: "Ann", lastName: "Lee" }]]),
    users: [],
    isLoading: false,
  }),
}));

import { SendToTechCard } from "./send-to-tech-card";

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    dealNumber: "1042",
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "Phoenix",
    address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
    jobTypeId: "jt-lockout",
    superStatus: JobSuperStatus.SUBMITTED,
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    assignedTechIds: ["t1"],
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

// Today at that clock time. The stamp a dispatcher reads is the time alone
// only while it happened today (`formatStamp`), so a fixture pinned to a
// calendar date stops matching the day after it was written.
const at = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

beforeEach(() => {
  mocks.send.mockReset();
  mocks.settings = undefined;
  mocks.assignments = [];
});

describe("SendToTechCard", () => {
  it("ticks SMS by default and sends only the ticked channels", async () => {
    render(<SendToTechCard deal={deal()} canEdit />);
    expect(screen.getByRole("checkbox", { name: "SMS" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Email" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "In App" })).not.toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: /send to tech/i }));
    expect(mocks.send).toHaveBeenCalledWith({ channels: ["sms"] });
  });

  it("adopts the workspace default from messaging settings", () => {
    mocks.settings = { sendToTechChannels: ["sms", "in_app"] };
    render(<SendToTechCard deal={deal()} canEdit />);
    expect(screen.getByRole("checkbox", { name: "SMS" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "In App" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Email" })).not.toBeChecked();
  });

  it("keeps the channels in a stable order however they are ticked", async () => {
    render(<SendToTechCard deal={deal()} canEdit />);
    await userEvent.click(screen.getByRole("checkbox", { name: "In App" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Email" }));
    await userEvent.click(screen.getByRole("button", { name: /send to tech/i }));
    expect(mocks.send).toHaveBeenCalledWith({ channels: ["sms", "email", "in_app"] });
  });

  it("refuses to send with nothing ticked", async () => {
    render(<SendToTechCard deal={deal()} canEdit />);
    await userEvent.click(screen.getByRole("checkbox", { name: "SMS" }));
    expect(screen.getByRole("button", { name: /send to tech/i })).toBeDisabled();
  });

  it("will not send a job with nobody on it, and says why", () => {
    render(<SendToTechCard deal={deal({ assignedTechIds: [] })} canEdit />);
    expect(screen.getByRole("button", { name: /send to tech/i })).toBeDisabled();
    expect(screen.getByText(/assign a technician before sending/i)).toBeInTheDocument();
  });

  it("is read-only without deals.edit", () => {
    render(<SendToTechCard deal={deal()} canEdit={false} />);
    expect(screen.getByRole("button", { name: /send to tech/i })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "SMS" })).toBeDisabled();
  });

  it("shows the sent stamp with its channels, and offers a resend", () => {
    render(
      <SendToTechCard
        deal={deal({ sentToTechAt: at(12, 10), sentToTechVia: ["sms", "email"] })}
        canEdit
      />,
    );
    expect(screen.getByText("Sent · 12:10 PM via SMS & Email")).toBeInTheDocument();
    // Workiz lets a dispatcher press again — the button relabels, it does not vanish.
    expect(screen.getByRole("button", { name: /resend/i })).toBeEnabled();
    expect(screen.getByText(/not seen yet/i)).toBeInTheDocument();
  });

  it("lights the eye up once a technician has opened the job", () => {
    render(
      <SendToTechCard
        deal={deal({ sentToTechAt: at(12, 10), sentToTechVia: ["sms"], seenByTechAt: at(12, 14) })}
        canEdit
      />,
    );
    expect(screen.getByText("Seen · 12:14 PM")).toBeInTheDocument();
    expect(screen.queryByText(/not seen yet/i)).toBeNull();
  });

  it("says nothing about stamps on a job that has never been sent", () => {
    render(<SendToTechCard deal={deal()} canEdit />);
    expect(screen.getByText(/not sent to the technician yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Sent ·/)).toBeNull();
  });

  it("names what each channel did per technician, with a reason for what did not go", () => {
    mocks.assignments = [
      {
        dealId: "d1",
        techId: "t1",
        sentAt: at(12, 10),
        sentVia: ["sms", "email"],
        seenAt: at(12, 14),
        deliveries: {
          sms: { status: "sent", sentAt: at(12, 10), at: at(12, 10), messageId: "m1" },
          email: { status: "skipped", sentAt: at(12, 10), at: at(12, 10), reason: "no_email" },
        },
      },
    ];
    render(
      <SendToTechCard deal={deal({ sentToTechAt: at(12, 10), sentToTechVia: ["sms", "email"] })} canEdit />,
    );
    expect(screen.getByText("Ann Lee")).toBeInTheDocument();
    expect(screen.getByText("SMS · sent")).toBeInTheDocument();
    expect(screen.getByText(/Email · skipped: no email on file/)).toBeInTheDocument();
    expect(screen.getByText(/seen 12:14 PM/)).toBeInTheDocument();
  });

  it("says a channel is still on its way while messaging has not reported back", () => {
    mocks.assignments = [{ dealId: "d1", techId: "t1", sentAt: at(12, 10), sentVia: ["sms"] }];
    render(<SendToTechCard deal={deal({ sentToTechAt: at(12, 10), sentToTechVia: ["sms"] })} canEdit />);
    expect(screen.getByText(/SMS · sending…/)).toBeInTheDocument();
  });

  it("does not explain a row for somebody no longer on the job", () => {
    mocks.assignments = [{ dealId: "d1", techId: "t-old", sentAt: at(12, 10), sentVia: ["sms"] }];
    render(<SendToTechCard deal={deal({ sentToTechAt: at(12, 10), sentToTechVia: ["sms"] })} canEdit />);
    expect(screen.queryByText(/SMS · /)).toBeNull();
  });
});
