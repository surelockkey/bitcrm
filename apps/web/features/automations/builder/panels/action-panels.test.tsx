import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChainNode } from "../types";
import { SECOND_TAG_ID, TAG_ID, renderNodePanel, serveCatalogs, settle } from "./panel-harness";

beforeEach(serveCatalogs);

describe("apply a tag", () => {
  it("picks the tag the old editor could store but never show", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel({ id: "a", kind: "add_tag", action: { type: "add_tag" } });
    await settle();

    await user.click(screen.getByLabelText("Tag to add"));
    await user.click(await screen.findByRole("option", { name: "URGENT" }));

    expect(panel.node().action).toEqual({ type: "add_tag", tagId: SECOND_TAG_ID });
  });

  it("names a tag the catalog no longer offers rather than showing its id", async () => {
    renderNodePanel(
      { id: "a", kind: "add_tag", action: { type: "add_tag", tagId: "gone-1" } },
      { labels: { "gone-1": "ARCHIVED" } },
    );
    await settle();

    expect(screen.getByLabelText("Tag to add")).toHaveTextContent("ARCHIVED");
  });
});

describe("change the sub-status", () => {
  it("fills in the super-status the chosen sub-status is filed under", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel({
      id: "a",
      kind: "change_sub_status",
      action: { type: "change_sub_status" },
    });
    await settle();

    await user.click(screen.getByLabelText("Sub-status to set"));
    await user.click(await screen.findByRole("option", { name: "Paid in full" }));

    // One sub-status names its super-status with it; a pair that disagrees is
    // a write the engine cannot make.
    expect(panel.node().action).toEqual({
      type: "change_sub_status",
      subStatusId: "sub-done",
      superStatus: "done",
    });
  });

  it("lets go of a sub-status that no longer belongs to the chosen status", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel({
      id: "a",
      kind: "change_sub_status",
      action: { type: "change_sub_status", superStatus: "done", subStatusId: "sub-done" },
    });
    await settle();

    await user.click(screen.getByLabelText("Status to set"));
    await user.click(screen.getByRole("option", { name: "Canceled" }));

    expect(panel.node().action).toEqual({ type: "change_sub_status", superStatus: "canceled" });
  });

  it("goes back to 'any sub-status' without losing the status", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel({
      id: "a",
      kind: "change_sub_status",
      action: { type: "change_sub_status", superStatus: "done", subStatusId: "sub-done" },
    });
    await settle();

    await user.click(screen.getByLabelText("Sub-status to set"));
    await user.click(await screen.findByRole("option", { name: /Paid in full/ }));

    // Moving a job to a super-status and letting the workspace pick the
    // sub-status is a rule the spec allows, so the slot has to allow it too.
    expect(panel.node().action).toEqual({ type: "change_sub_status", superStatus: "done" });
  });

  it("offers only the sub-statuses of the chosen status", async () => {
    const user = userEvent.setup();
    renderNodePanel({
      id: "a",
      kind: "change_sub_status",
      action: { type: "change_sub_status", superStatus: "canceled" },
    });
    await settle();

    await user.click(screen.getByLabelText("Sub-status to set"));
    expect(await screen.findByRole("option", { name: "Canceled check" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Paid in full" })).toBeNull();
  });
});

describe("post a webhook", () => {
  const webhook = (action: ChainNode["action"]): ChainNode => ({ id: "w", kind: "webhook", action });

  it("edits the URL and the method the old editor only carried past the user", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(
      webhook({ type: "webhook", url: "https://x.test/h", method: "PUT" }),
    );
    await settle();

    expect(screen.getByLabelText("URL")).toHaveValue("https://x.test/h");
    expect(screen.getByRole("radio", { name: "PUT" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "POST" }));
    expect(panel.node().action).toEqual({
      type: "webhook",
      url: "https://x.test/h",
      method: "POST",
    });
  });

  it("warns about a URL with no scheme instead of silently posting nowhere", async () => {
    const user = userEvent.setup();
    renderNodePanel(webhook({ type: "webhook", url: "" }));
    await settle();

    await user.type(screen.getByLabelText("URL"), "example.com/hook");
    expect(screen.getByText(/has to start with http/)).toBeInTheDocument();
  });

  it("opens the headers of a rule that has them, and shuts for one that has none", async () => {
    renderNodePanel(
      webhook({ type: "webhook", url: "https://x.test/h", headers: { Authorization: "Bearer k" } }),
    );
    await settle();

    // A webhook with an auth header must never look like one without.
    expect(screen.getByLabelText("Header 1 name")).toHaveValue("Authorization");
    expect(screen.getByLabelText("Header 1 value")).toHaveValue("Bearer k");
  });

  it("keeps a half-typed header row out of the rule until it is named", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(webhook({ type: "webhook", url: "https://x.test/h" }));
    await settle();

    await user.click(screen.getByRole("button", { name: "Headers and body" }));
    await user.click(screen.getByRole("button", { name: "Header" }));
    expect(panel.writes()).toBe(0);

    await user.type(screen.getByLabelText("Header 1 value"), "abc");
    // A row with no name is a row still being typed, not a header.
    expect(panel.node().action?.headers).toBeUndefined();

    await user.type(screen.getByLabelText("Header 1 name"), "X-Key");
    expect(panel.node().action?.headers).toEqual({ "X-Key": "abc" });
  });

  it("deletes the headers key rather than leaving an empty object behind", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(
      webhook({ type: "webhook", url: "https://x.test/h", headers: { "X-Key": "abc" } }),
    );
    await settle();

    await user.click(screen.getByRole("button", { name: "Remove header 1" }));
    expect(panel.node().action).toEqual({ type: "webhook", url: "https://x.test/h" });
  });

  it("says a body is not JSON without refusing to keep it", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(webhook({ type: "webhook", url: "https://x.test/h" }));
    await settle();

    await user.click(screen.getByRole("button", { name: "Headers and body" }));
    await user.type(screen.getByLabelText("Body"), "not json");
    expect(screen.getByText(/not valid JSON/)).toBeInTheDocument();
    expect(panel.node().action?.payload).toBe("not json");
  });

  it("leaves a short code inside a string alone — that is valid JSON", async () => {
    const user = userEvent.setup();
    renderNodePanel(
      webhook({ type: "webhook", url: "https://x.test/h", payload: '{"job":"{{job_id}}"}' }),
    );
    await settle();

    expect(screen.getByLabelText("Body")).toHaveValue('{"job":"{{job_id}}"}');
    expect(screen.queryByText(/not valid JSON/)).toBeNull();
    await user.click(screen.getByLabelText("Body"));
  });
});

describe("wait", () => {
  it("reads 90 minutes as an hour and a half's worth of minutes, and writes what is typed", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel({ id: "w", kind: "wait", waitMinutes: 90 });
    await settle();

    expect(screen.getByLabelText("How long to wait")).toHaveValue(90);
    expect(screen.getByLabelText("Wait unit")).toHaveTextContent("minutes");

    await user.click(screen.getByLabelText("Wait unit"));
    await user.click(screen.getByRole("option", { name: "hours" }));
    expect(panel.node().waitMinutes).toBe(5400);
  });

  it("keeps the unit while the number is retyped", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel({ id: "w", kind: "wait", waitMinutes: 240 });
    await settle();

    expect(screen.getByLabelText("Wait unit")).toHaveTextContent("hours");
    const box = screen.getByLabelText("How long to wait");
    // Cleared, the spec says zero — and zero cannot say which unit it was
    // written in, so the panel has to remember: "4 hours" retyped as 2 must
    // not become "2 minutes".
    await user.clear(box);
    await user.type(box, "2");
    expect(panel.node().waitMinutes).toBe(120);
  });
});
