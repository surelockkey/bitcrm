import { describe, it, expect } from "vitest";
import { chainNodeSummary, nodeIssue } from "./node-summary";
import { specToChain, type ChainNode } from "./types";

const node = (over: Partial<ChainNode>): ChainNode => ({ id: "x", kind: "send", ...over });

const chainOn = (kind: string): ChainNode[] => [
  { id: "t", kind: "trigger", trigger: { kind: kind as "deal.created" } },
];

describe("chainNodeSummary", () => {
  it("says the trigger in the same words the rule's own sentence uses", () => {
    expect(chainNodeSummary(node({ kind: "trigger", trigger: { kind: "deal.created" } }))).toBe(
      "When a job is created",
    );
    expect(
      chainNodeSummary(node({ kind: "trigger", trigger: { kind: "deal.status_changed", to: ["canceled"] } })),
    ).toBe("When a job has a status of Canceled");
    expect(
      chainNodeSummary(node({ kind: "trigger", trigger: { kind: "call.completed", callOutcome: "missed" } })),
    ).toBe("When a call is missed");
  });

  it("says a condition as its own clause, without the word that joins it", () => {
    expect(
      chainNodeSummary(node({ kind: "condition", condition: { field: "tag", op: "in", values: ["t1"] } }), {
        t1: "SCHEDULED",
      }),
    ).toBe("Its job tag is SCHEDULED");
    expect(
      chainNodeSummary(
        node({
          kind: "condition",
          condition: {
            any: [
              { field: "source", op: "in", values: ["a"], labels: ["GMB"] },
              { field: "source", op: "in", values: ["b"], labels: ["Yelp"] },
            ],
          },
        }),
      ),
    ).toBe("Its source is one of GMB or Yelp");
    expect(chainNodeSummary(node({ kind: "condition", condition: { field: "hasTechs", op: "exists" } }))).toBe(
      "It has a technician",
    );
  });

  it("says what each action does", () => {
    expect(chainNodeSummary(node({ action: { type: "send_sms", to: "assigned_techs" } }))).toBe(
      "Send the assigned tech a text message",
    );
    expect(
      chainNodeSummary(node({ kind: "webhook", action: { type: "webhook", url: "https://x.test/h" } })),
    ).toBe("Post a webhook to https://x.test/h");
    expect(chainNodeSummary(node({ kind: "add_tag", action: { type: "add_tag", tagId: "t1" } }), { t1: "VIP" })).toBe(
      "Add the tag VIP",
    );
  });

  it("says how long a wait holds the steps below it", () => {
    expect(chainNodeSummary(node({ kind: "wait", waitMinutes: 60 }))).toBe(
      "Wait 1 hour before the steps below",
    );
    expect(chainNodeSummary(node({ kind: "wait", waitMinutes: 1440 }))).toBe(
      "Wait 1 day before the steps below",
    );
  });

  it("invites the reader to fill in a step nobody has", () => {
    expect(chainNodeSummary(node({ kind: "send", action: undefined }))).toBe("Choose what to send");
    expect(chainNodeSummary(node({ kind: "wait", waitMinutes: 0 }))).toBe("Choose how long to wait");
    expect(chainNodeSummary(node({ kind: "condition" }))).toBe("Choose what to check");
  });
});

describe("nodeIssue", () => {
  const chain = chainOn("deal.created");

  it("keeps a finished step quiet", () => {
    expect(nodeIssue(node({ action: { type: "send_sms", to: "client", body: "Hi" } }), chain)).toBeUndefined();
    expect(nodeIssue(chain[0], chain)).toBeUndefined();
  });

  it("blocks the save for a step the save would refuse, in the same words", () => {
    expect(nodeIssue(node({ action: { type: "send_sms", to: "client", body: "" } }), chain)).toEqual({
      level: "blocks",
      text: "Write a message or pick a template",
    });
    expect(nodeIssue(node({ kind: "webhook", action: { type: "webhook" } }), chain)).toEqual({
      level: "blocks",
      text: "A webhook needs a URL",
    });
    expect(
      nodeIssue(node({ action: { type: "send_sms", to: "users", body: "Hi" } }), chain)?.text,
    ).toMatch(/at least one person/i);
    expect(nodeIssue(node({ action: { type: "send_sms", to: "role", body: "Hi" } }), chain)?.text).toMatch(
      /at least one role/i,
    );
  });

  it("blocks a tag or a status step with nothing chosen — the engine would run it and do nothing", () => {
    expect(nodeIssue(node({ kind: "add_tag", action: { type: "add_tag" } }), chain)).toEqual({
      level: "blocks",
      text: "Pick the tag to put on the job",
    });
    expect(
      nodeIssue(node({ kind: "change_sub_status", action: { type: "change_sub_status" } }), chain),
    ).toEqual({ level: "blocks", text: "Pick the status to move the job to" });
    expect(
      nodeIssue(node({ kind: "add_tag", action: { type: "add_tag", tagId: "t1" } }), chain),
    ).toBeUndefined();
  });

  it("warns, without refusing, where a step narrows nothing", () => {
    expect(nodeIssue(node({ kind: "condition", condition: { field: "tag", op: "in", values: [] } }), chain)).toEqual({
      level: "warns",
      text: "Nothing picked, so this line narrows nothing and is not saved with the rule.",
    });
    expect(
      nodeIssue(node({ kind: "condition", condition: { any: [{ field: "tag", op: "in", values: [] }] } }), chain)
        ?.level,
    ).toBe("warns");
    expect(
      nodeIssue(node({ kind: "condition", condition: { field: "tag", op: "in", values: ["t1"] } }), chain),
    ).toBeUndefined();
  });

  it("warns that a status trigger naming no status fires on every status change", () => {
    const [trigger] = specToChain(undefined);
    expect(nodeIssue(trigger, [trigger])?.text).toMatch(/every status change/i);
  });

  it("warns that a recipient off the job reaches nobody when the trigger has no job", () => {
    const calls = chainOn("call.completed");
    const issue = nodeIssue(node({ action: { type: "send_sms", to: "dispatcher", body: "Hi" } }), calls);
    expect(issue?.level).toBe("warns");
    expect(issue?.text).toMatch(/would reach nobody/i);
    // The same step under a job trigger is fine — that is where a dispatcher
    // can be read off.
    expect(nodeIssue(node({ action: { type: "send_sms", to: "dispatcher", body: "Hi" } }), chain)).toBeUndefined();
  });

  it("warns about a wait of nothing", () => {
    expect(nodeIssue(node({ kind: "wait", waitMinutes: 0 }), chain)?.level).toBe("warns");
    expect(nodeIssue(node({ kind: "wait", waitMinutes: 15 }), chain)).toBeUndefined();
  });
});
