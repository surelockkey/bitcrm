import { describe, expect, it } from "vitest";
import type { CallFlow, ResolvedCallGroupMember } from "@bitcrm/types";
import {
  flowNumbersText,
  flowOfNumber,
  formatNumberCreated,
  groupMembersText,
  numberFlowMoves,
} from "./phone-settings";

const flow = (id: string, numbers: string[], over: Partial<CallFlow> = {}): CallFlow =>
  ({
    id,
    name: id.toUpperCase(),
    numbers,
    entryNodeId: "a",
    nodes: {},
    active: true,
    version: 1,
    createdBy: "u",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }) as CallFlow;

describe("formatNumberCreated", () => {
  it("reads like Workiz's Created cell — weekday, 12-hour clock, lower-case am/pm", () => {
    // 2020-09-28 03:11 UTC is Sun Sep 27, 11:11 pm in New York (pg_settings_phone_wz_numbers).
    expect(formatNumberCreated("2020-09-28T03:11:00.000Z", "America/New_York")).toBe("Sun Sep 27, 2020 11:11 pm");
    expect(formatNumberCreated("2018-06-10T09:38:00.000Z", "America/New_York")).toBe("Sun Jun 10, 2018 05:38 am");
  });

  it("is empty when the server does not say (an older API, or Twilio silent)", () => {
    expect(formatNumberCreated(undefined)).toBe("");
    expect(formatNumberCreated(null)).toBe("");
    expect(formatNumberCreated("not a date")).toBe("");
  });
});

describe("flowOfNumber", () => {
  it("finds the flow that answers a number", () => {
    const flows = [flow("a", ["+12035550100"]), flow("b", ["+12035550111", "+12035550122"])];
    expect(flowOfNumber(flows, "+12035550122")?.id).toBe("b");
    expect(flowOfNumber(flows, "+19995550000")).toBeUndefined();
  });

  it("matches a number however it was written", () => {
    expect(flowOfNumber([flow("a", ["(203) 555-0100"])], "+12035550100")?.id).toBe("a");
  });
});

describe("numberFlowMoves", () => {
  const flows = [flow("a", ["+12035550100", "+12035550111"]), flow("b", ["+12035550122"]), flow("c", [])];

  it("moves a number: off its flow first (a number has one flow), then onto the new one", () => {
    expect(numberFlowMoves(flows, "+12035550111", "b")).toEqual([
      { id: "a", numbers: ["+12035550100"] },
      { id: "b", numbers: ["+12035550122", "+12035550111"] },
    ]);
  });

  it("gives an unassigned number its flow in one write", () => {
    expect(numberFlowMoves(flows, "+12035550199", "c")).toEqual([{ id: "c", numbers: ["+12035550199"] }]);
  });

  it("takes the number off its flow for Remove flow (null)", () => {
    expect(numberFlowMoves(flows, "+12035550122", null)).toEqual([{ id: "b", numbers: [] }]);
  });

  it("does nothing when the number already sits on that flow, or has none to remove", () => {
    expect(numberFlowMoves(flows, "+12035550122", "b")).toEqual([]);
    expect(numberFlowMoves(flows, "+12035550199", null)).toEqual([]);
  });

  it("does nothing for a flow that is not there", () => {
    expect(numberFlowMoves(flows, "+12035550122", "gone")).toEqual([]);
  });
});

describe("flowNumbersText", () => {
  it("lists a flow's numbers as Workiz's Numbers cell does — formatted, comma, no space", () => {
    expect(flowNumbersText(["+14698483641", "+18032192657"])).toBe("(469) 848-3641,(803) 219-2657");
    expect(flowNumbersText([])).toBe("");
  });
});

describe("groupMembersText", () => {
  const m = (over: Partial<ResolvedCallGroupMember>): ResolvedCallGroupMember => ({
    userId: "u",
    channel: "softphone",
    order: 0,
    enabled: true,
    softphoneOnline: false,
    missing: false,
    name: "Lily Support Manager",
    ...over,
  });

  it("says how each member is rung, as Workiz's Users and devices column does", () => {
    expect(
      groupMembersText([
        m({ name: "Lily Support Manager", channel: "softphone" }),
        m({ name: "Kobi", channel: "personal", phone: "+12039893585" }),
        m({ name: "Tess", channel: "both", phone: "+12039023322" }),
      ]),
    ).toBe("Lily Support Manager (Softphone), Kobi ((203) 989-3585), Tess (Softphone, (203) 902-3322)");
  });

  it("keeps the ring order and names a member who has left", () => {
    expect(
      groupMembersText([
        m({ name: "Second", order: 1 }),
        m({ name: undefined, order: 0, missing: true }),
      ]),
    ).toBe("Former teammate (Softphone), Second (Softphone)");
  });

  it("names the personal phone even when none is on file", () => {
    expect(groupMembersText([m({ name: "Kobi", channel: "personal", phone: undefined })])).toBe("Kobi (Personal phone)");
  });

  it("is empty for a group with nobody in it", () => {
    expect(groupMembersText([])).toBe("");
  });
});
