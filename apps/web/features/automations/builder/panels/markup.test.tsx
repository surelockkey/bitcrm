import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ChainNode } from "../types";
import { TAG_ID, renderNodePanel, serveCatalogs, settle } from "./panel-harness";

beforeEach(serveCatalogs);

/**
 * A file of its own, and this must be the first thing in it that renders a
 * panel: React reports each bad tag pairing once per module instance, so a
 * nesting error raised by an earlier test in the same file is silent by the
 * time a later one looks for it. Vitest gives every file its own instance.
 */
describe("the markup the panels build", () => {
  /**
   * The builder is a client component inside a server-rendered page, so markup
   * the HTML parser has to correct — a `<div>` inside the `<p>` of a sentence,
   * say, where the parser closes the paragraph early — is a hydration error on
   * first paint and a sentence whose slots have fallen out of their line.
   * React says so on `console.error` and nothing else in the suite is
   * listening, so the whole builder is walked past one listener here.
   */
  it("is markup the HTML parser does not have to correct", async () => {
    const complained: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const text = args.map(String).join(" ");
      if (!/cannot be a descendant|cannot contain a nested|validateDOMNesting/i.test(text)) return;
      // React logs these as a format string plus its arguments, so the tags —
      // the only part worth reading in a failure — are filled back in here.
      const [format, ...rest] = args;
      let at = 0;
      complained.push(
        String(format)
          .split("\n")[0]
          .replace(/%s/g, () => String(rest[at++])),
      );
    });

    const nodes: ChainNode[] = [
      { id: "1", kind: "trigger", trigger: { kind: "deal.status_changed", to: ["done"] } },
      {
        id: "2",
        kind: "trigger",
        trigger: { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -60 },
      },
      { id: "3", kind: "trigger", trigger: { kind: "call.completed", callDirection: "inbound" } },
      { id: "4", kind: "condition", condition: { field: "tag", op: "in", values: [TAG_ID] } },
      { id: "5", kind: "send", action: { type: "send_sms", to: "number", number: "+1", body: "Hi" } },
      { id: "6", kind: "add_tag", action: { type: "add_tag", tagId: TAG_ID } },
      { id: "7", kind: "change_sub_status", action: { type: "change_sub_status", superStatus: "done" } },
      {
        id: "8",
        kind: "webhook",
        action: { type: "webhook", url: "https://x.test/h", headers: { A: "b" }, payload: "{}" },
      },
      { id: "9", kind: "wait", waitMinutes: 90 },
    ];

    try {
      for (const node of nodes) {
        const panel = renderNodePanel(node, { chain: nodes });
        await settle();
        panel.unmount();
      }
    } finally {
      spy.mockRestore();
    }

    expect(complained).toEqual([]);
  });
});
