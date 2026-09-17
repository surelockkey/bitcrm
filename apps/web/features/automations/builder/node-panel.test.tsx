import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import type { AutomationLabelMap } from "@bitcrm/types";
import { nodeSummary } from "./node-panel";
import type { ChainNode } from "./types";
import {
  SECOND_TAG_ID,
  TAG_ID,
  renderNodePanel,
  serveCatalogs,
  settle,
} from "./panels/panel-harness";

const labels: AutomationLabelMap = {
  [TAG_ID]: "SCHEDULED",
  [SECOND_TAG_ID]: "URGENT",
  "sub-done": "Paid in full",
  "src-gmb": "GMB",
  "src-yelp": "Yelp",
};

beforeEach(serveCatalogs);

describe("nodeSummary", () => {
  it("says the trigger in the words the rules list uses", () => {
    expect(nodeSummary({ id: "1", kind: "trigger", trigger: { kind: "deal.created" } }, {})).toBe(
      "When a job is created",
    );
    // The super-status names come from the same floor `specSentence` lays
    // down, so a card here and a card on the list read identically.
    expect(
      nodeSummary(
        { id: "1", kind: "trigger", trigger: { kind: "deal.status_changed", to: ["done"] } },
        {},
      ),
    ).toBe("When a job has a status of Done");
  });

  it("invites a step nobody has filled in yet", () => {
    expect(nodeSummary({ id: "1", kind: "trigger" }, {})).toBe("Choose a trigger");
    expect(nodeSummary({ id: "2", kind: "condition" }, {})).toBe("Choose what to check");
    expect(nodeSummary({ id: "3", kind: "send" }, {})).toBe("Choose what to send");
    expect(nodeSummary({ id: "4", kind: "wait" }, {})).toBe("Choose how long to wait");
    // The sentence builder would answer "add the tag" / "post a webhook to a
    // URL" for these; a card wants to be told what is missing instead.
    expect(nodeSummary({ id: "5", kind: "add_tag", action: { type: "add_tag" } }, {})).toBe(
      "Choose a tag",
    );
    expect(nodeSummary({ id: "6", kind: "webhook", action: { type: "webhook" } }, {})).toBe(
      "Choose where to post",
    );
  });

  it("says a condition as the clause it is", () => {
    const node: ChainNode = {
      id: "c",
      kind: "condition",
      condition: { field: "tag", op: "in", values: [TAG_ID], labels: ["SCHEDULED"] },
    };
    expect(nodeSummary(node, {})).toBe("Its job tag is SCHEDULED");
  });

  it("says an 'or' group as one list, not as two conditions", () => {
    const node: ChainNode = {
      id: "c",
      kind: "condition",
      condition: {
        any: [
          { field: "source", op: "in", values: ["src-gmb"] },
          { field: "source", op: "in", values: ["src-yelp"] },
        ],
      },
    };
    expect(nodeSummary(node, labels)).toBe("Its source is one of GMB or Yelp");
  });

  it("does not let the trigger it borrows swallow a status condition", () => {
    // `automationConditionsSentence` drops a condition its trigger already
    // said. The spec built for one node names a trigger that speaks for
    // nothing, so a lone status condition still reads.
    const node: ChainNode = {
      id: "c",
      kind: "condition",
      condition: { field: "status", op: "in", values: ["done"] },
    };
    expect(nodeSummary(node, {})).toBe("Its status is Done");
  });

  it("says the actions", () => {
    expect(
      nodeSummary({ id: "a", kind: "send", action: { type: "send_sms", to: "client" } }, {}),
    ).toBe("Send the client a text message");
    expect(
      nodeSummary({ id: "a", kind: "send", action: { type: "send_email", to: "assigned_techs" } }, {}),
    ).toBe("Send the assigned tech an email");
    expect(
      nodeSummary({ id: "a", kind: "add_tag", action: { type: "add_tag", tagId: TAG_ID } }, labels),
    ).toBe("Add the tag SCHEDULED");
    expect(
      nodeSummary(
        { id: "a", kind: "change_sub_status", action: { type: "change_sub_status", subStatusId: "sub-done" } },
        labels,
      ),
    ).toBe("Set the status to Paid in full");
    expect(
      nodeSummary({ id: "a", kind: "webhook", action: { type: "webhook", url: "https://x.test/h" } }, {}),
    ).toBe("Post a webhook to https://x.test/h");
  });

  it("says a wait as the delay it is, and where the engine counts it from", () => {
    // Not "before the steps below": the engine holds one delay per rule and
    // counts it from the trigger, so a wait between two sends holds them both.
    expect(nodeSummary({ id: "w", kind: "wait", waitMinutes: 240 }, {})).toBe(
      "Wait 4 hours before this rule does anything",
    );
    expect(nodeSummary({ id: "w", kind: "wait", waitMinutes: 1440 }, {})).toBe(
      "Wait 1 day before this rule does anything",
    );
    expect(nodeSummary({ id: "w", kind: "wait", waitMinutes: 0 }, {})).toBe("Choose how long to wait");
  });
});

describe("NodePanel", () => {
  it("opens the panel that belongs to the node, headed by its own sentence", async () => {
    renderNodePanel({
      id: "t",
      kind: "trigger",
      trigger: { kind: "deal.status_changed", to: ["done"] },
    });
    await settle();

    expect(screen.getByRole("heading", { name: "Trigger" })).toBeInTheDocument();
    expect(screen.getByText("When a job has a status of Done")).toBeInTheDocument();
    expect(screen.getByLabelText("Status entered")).toBeInTheDocument();
  });

  /**
   * The rule that outranks every other: a rule opened and saved without a
   * deliberate change must store byte for byte what it was. A panel that
   * normalised anything on mount — added a `callOutcome: 'any'`, rebuilt an
   * `{any: [...]}` group, filled in a default method — would widen somebody's
   * live rule for the price of clicking on it.
   */
  it("writes nothing back when a node is merely opened", async () => {
    const nodes: ChainNode[] = [
      { id: "1", kind: "trigger", trigger: { kind: "deal.created" } },
      { id: "2", kind: "trigger", trigger: { kind: "call.completed" } },
      { id: "3", kind: "trigger", trigger: { kind: "message.received", messageChannel: "sms" } },
      {
        id: "4",
        kind: "trigger",
        trigger: { kind: "deal.status_changed", to: ["done"], toSubStatus: ["sub-done"], onCreate: false },
      },
      { id: "5", kind: "trigger", trigger: { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -60 } },
      { id: "6", kind: "condition", condition: { field: "tag", op: "in", values: [TAG_ID] } },
      { id: "7", kind: "condition", condition: { any: [{ field: "source", op: "eq", values: ["src-gmb"] }] } },
      { id: "8", kind: "condition", condition: { field: "tag", op: "exists" } },
      { id: "9", kind: "send", action: { type: "send_sms", to: "client", body: "Hi" } },
      { id: "10", kind: "send", action: { type: "send_email", to: "users", userIds: ["u1"], subject: "S", body: "B" } },
      { id: "11", kind: "add_tag", action: { type: "add_tag", tagId: TAG_ID } },
      {
        id: "12",
        kind: "change_sub_status",
        action: { type: "change_sub_status", superStatus: "done", subStatusId: "sub-done" },
      },
      {
        id: "13",
        kind: "webhook",
        action: {
          type: "webhook",
          url: "https://x.test/h",
          method: "PUT",
          headers: { Authorization: "Bearer k" },
          payload: '{"id":"{{job_id}}"}',
        },
      },
      { id: "14", kind: "wait", waitMinutes: 90 },
    ];

    for (const node of nodes) {
      const panel = renderNodePanel(node, { labels });
      await settle();
      expect(screen.getByRole("heading", { level: 3 })).toBeInTheDocument();
      expect(panel.writes(), `${node.kind} #${node.id} wrote on open`).toBe(0);
      // Cleanup runs between tests, not inside one, so each node's panel comes
      // off the page before the next goes on.
      panel.unmount();
    }
  });
});
