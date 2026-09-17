import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChainNode } from "../types";
import { renderNodePanel, serveCatalogs, settle } from "./panel-harness";

beforeEach(serveCatalogs);

const triggerNode = (trigger: ChainNode["trigger"]): ChainNode => ({ id: "t", kind: "trigger", trigger });

const entitySlot = () => screen.getByLabelText("What the rule is about");
const eventSlot = () => screen.getByLabelText("What happens to it");

describe("the trigger sentence", () => {
  it("reads 'When a job is created' with each half a list", async () => {
    renderNodePanel(triggerNode({ kind: "deal.created" }));
    await settle();

    expect(entitySlot()).toHaveTextContent("a job");
    expect(eventSlot()).toHaveTextContent("is created");
  });

  it("offers only the three entities the engine actually delivers", async () => {
    const user = userEvent.setup();
    renderNodePanel(triggerNode({ kind: "deal.created" }));
    await settle();

    await user.click(entitySlot());
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "a job",
      "a call",
      "a message",
    ]);
    // Leads, estimates and invoices are out of scope by the owner's decision,
    // and an entity offered that never arrives is a rule that never fires.
    expect(screen.queryByRole("option", { name: /lead|estimate|invoice/i })).toBeNull();
  });

  it("lists a job's events, a call's events and a message's one event", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(triggerNode({ kind: "deal.created" }));
    await settle();

    await user.click(eventSlot());
    expect(screen.getByRole("option", { name: /has a status of/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /is rescheduled/ })).toBeInTheDocument();
    // `schedule.relative` was a trigger the old editor could choose; it is an
    // event of the job here rather than a capability quietly dropped.
    expect(screen.getByRole("option", { name: /is coming up/ })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(entitySlot());
    await user.click(screen.getByRole("option", { name: "a call" }));
    expect(panel.node().trigger).toEqual({ kind: "call.completed", callOutcome: "missed" });

    await user.click(eventSlot());
    expect(screen.getAllByRole("option").map((o) => o.textContent?.trim())).toEqual([
      "is missed",
      "is answered",
      "goes to voicemail",
      "ends",
    ]);
  });

  it("drops what no longer applies when the event changes kind", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(
      triggerNode({ kind: "deal.status_changed", to: ["done"], toSubStatus: ["sub-done"], onCreate: false }),
    );
    await settle();

    await user.click(eventSlot());
    await user.click(screen.getByRole("option", { name: /matches/ }));

    // `to`, `toSubStatus` and `onCreate` belong to the status trigger alone —
    // `toSpec` has always dropped them here, and the panel now says so.
    expect(panel.node().trigger).toEqual({ kind: "deal.updated" });
  });

  it("gives a relative reminder the anchor and offset it cannot do without", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(triggerNode({ kind: "deal.created" }));
    await settle();

    await user.click(eventSlot());
    await user.click(screen.getByRole("option", { name: /is coming up/ }));

    expect(panel.node().trigger).toEqual({
      kind: "schedule.relative",
      anchor: "scheduledStart",
      offsetMinutes: 0,
    });
  });
});

describe("a call trigger's outcome", () => {
  it("writes the outcome the event names", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(triggerNode({ kind: "call.completed", callOutcome: "missed" }));
    await settle();

    await user.click(eventSlot());
    await user.click(screen.getByRole("option", { name: /goes to voicemail/ }));
    expect(panel.node().trigger).toEqual({ kind: "call.completed", callOutcome: "voicemail" });
  });

  it("does not add 'any' to a trigger that never stored an outcome", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(triggerNode({ kind: "call.completed" }));
    await settle();

    // An absent `callOutcome` already means "any": re-picking the event it is
    // already on must not write a key the stored rule never had.
    expect(eventSlot()).toHaveTextContent("ends");
    await user.click(eventSlot());
    await user.click(screen.getByRole("option", { name: "ends" }));
    expect(panel.writes()).toBe(0);
  });
});

describe("'has a status of'", () => {
  it("opens the status and sub-status pickers and stores the ids", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(triggerNode({ kind: "deal.status_changed", to: ["done"] }));
    await settle();

    await user.click(screen.getByLabelText("Sub-status entered"));
    // Only the sub-statuses filed under Done — one of another super-status can
    // never be entered by this trigger.
    expect(await screen.findByRole("option", { name: "Paid in full" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Canceled check" })).toBeNull();

    await user.click(screen.getByRole("option", { name: "Paid in full" }));
    expect(panel.node().trigger).toEqual({
      kind: "deal.status_changed",
      to: ["done"],
      toSubStatus: ["sub-done"],
    });
  });

  it("warns that emptying the status widens the rule, and stops once a sub-status holds it", async () => {
    const user = userEvent.setup();
    renderNodePanel(triggerNode({ kind: "deal.status_changed" }));
    await settle();

    expect(screen.getByText(/narrows nothing/)).toBeInTheDocument();

    await user.click(screen.getByLabelText("Sub-status entered"));
    await user.click(await screen.findByRole("option", { name: "Canceled check" }));
    // Still narrowed — to a sub-status — so the warning would be warning about
    // a widening that has not happened.
    expect(screen.queryByText(/narrows nothing/)).toBeNull();
  });

  it("drops a sub-status the chosen statuses can no longer reach", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(
      triggerNode({ kind: "deal.status_changed", to: ["done"], toSubStatus: ["sub-done"] }),
    );
    await settle();

    await user.click(screen.getByLabelText("Status entered"));
    await user.click(await screen.findByRole("option", { name: "Canceled" }));
    await user.click(screen.getByRole("option", { name: "Done" }));

    expect(panel.node().trigger).toEqual({ kind: "deal.status_changed", to: ["canceled"] });
  });
});

describe("the narrowings the old editor never showed", () => {
  it("writes the status a job comes from", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(triggerNode({ kind: "deal.status_changed", to: ["done"] }));
    await settle();

    await user.click(screen.getByRole("button", { name: "Narrow it further" }));
    await user.click(screen.getByLabelText("Status left"));
    await user.click(screen.getByRole("option", { name: "Submitted" }));

    expect(panel.node().trigger).toEqual({
      kind: "deal.status_changed",
      to: ["done"],
      from: ["submitted"],
    });
  });

  it("writes onCreate only as the false it means, and deletes it again", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(triggerNode({ kind: "deal.status_changed", to: ["done"] }));
    await settle();

    await user.click(screen.getByRole("button", { name: "Narrow it further" }));
    const box = screen.getByRole("checkbox", {
      name: "A job created straight into this status counts too",
    });
    expect(box).toBeChecked();

    await user.click(box);
    expect(panel.node().trigger).toEqual({
      kind: "deal.status_changed",
      to: ["done"],
      onCreate: false,
    });

    // Back on, the key goes rather than becoming `true`: `true` is the
    // default, and a spec that spells out its defaults is a spec that differs
    // from every other rule in the workspace for no reason.
    await user.click(screen.getByRole("checkbox"));
    expect(panel.node().trigger).toEqual({ kind: "deal.status_changed", to: ["done"] });
  });

  it("stores a call's direction, and stores 'either way' as nothing at all", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(triggerNode({ kind: "call.completed", callOutcome: "missed" }));
    await settle();

    await user.click(screen.getByRole("button", { name: "Narrow it further" }));
    await user.click(screen.getByLabelText("Call direction"));
    await user.click(screen.getByRole("option", { name: /coming in/ }));
    expect(panel.node().trigger).toEqual({
      kind: "call.completed",
      callOutcome: "missed",
      callDirection: "inbound",
    });

    await user.click(screen.getByLabelText("Call direction"));
    await user.click(screen.getByRole("option", { name: /either way/ }));
    expect(panel.node().trigger).toEqual({ kind: "call.completed", callOutcome: "missed" });
  });

  it("stores a message's channel and sender", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(triggerNode({ kind: "message.received" }));
    await settle();

    await user.click(screen.getByRole("button", { name: "Narrow it further" }));
    await user.click(screen.getByLabelText("Message channel"));
    await user.click(screen.getByRole("option", { name: /a text message/ }));
    await user.click(screen.getByLabelText("Message sender"));
    await user.click(screen.getByRole("option", { name: /a contact/ }));

    expect(panel.node().trigger).toEqual({
      kind: "message.received",
      messageChannel: "sms",
      messagePartyKind: "contact",
    });
  });
});

describe("the relative reminder's row", () => {
  it("reads and writes '4 hours ahead of the job's start'", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(
      triggerNode({ kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -60 }),
    );
    await settle();

    const amount = screen.getByLabelText("How long");
    expect(amount).toHaveValue(1);
    expect(screen.getByLabelText("Unit")).toHaveTextContent("hours");
    expect(screen.getByLabelText("Before or after")).toHaveTextContent("ahead of");

    // Cleared, the spec says zero — and a zero cannot say which unit it was
    // written in, so the panel has to remember: "1 hour ahead" retyped as 4
    // must not become "4 minutes after".
    await user.clear(amount);
    await user.type(amount, "4");
    expect(panel.node().trigger?.offsetMinutes).toBe(-240);
  });

  it("keeps the number and changes the span when the unit changes", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(
      triggerNode({ kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -240 }),
    );
    await settle();

    expect(screen.getByLabelText("How long")).toHaveValue(4);
    await user.click(screen.getByLabelText("Unit"));
    await user.click(screen.getByRole("option", { name: "days" }));

    // Picking "days" beside a 4 asks for four days, not for however many days
    // four hours happens to be.
    expect(panel.node().trigger?.offsetMinutes).toBe(-5760);
    expect(screen.getByLabelText("How long")).toHaveValue(4);
  });

  it("refuses 'ahead of' a date that has already passed, and turns it round", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(
      triggerNode({ kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -60 }),
    );
    await settle();

    await user.click(screen.getByLabelText("Counted from"));
    await user.click(screen.getByRole("option", { name: /when it was created/ }));

    // `armRelative` arms nothing for a moment already gone, so "an hour ahead
    // of when it was created" is a rule that can never fire.
    expect(panel.node().trigger).toEqual({
      kind: "schedule.relative",
      anchor: "createdAt",
      offsetMinutes: 60,
    });

    await user.click(screen.getByLabelText("Before or after"));
    expect(screen.getByRole("option", { name: /ahead of/ })).toHaveAttribute("aria-disabled", "true");
  });
});
