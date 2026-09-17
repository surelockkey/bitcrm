import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChainNode } from "../types";
import { SECOND_TAG_ID, TAG_ID, renderNodePanel, serveCatalogs, settle } from "./panel-harness";

beforeEach(serveCatalogs);

const conditionNode = (condition: ChainNode["condition"]): ChainNode => ({
  id: "c",
  kind: "condition",
  condition,
});

describe("one condition", () => {
  it("is a property, an operator and chips", async () => {
    renderNodePanel(conditionNode({ field: "tag", op: "in", values: [TAG_ID], labels: ["SCHEDULED"] }));
    await settle();

    expect(screen.getByLabelText("Condition property")).toHaveTextContent("Job tag");
    expect(screen.getByRole("radio", { name: "is" })).toBeChecked();
    expect(screen.getByLabelText("Condition value")).toHaveTextContent("SCHEDULED");
  });

  it("stores several values from one row — the thing that collapses 24 copies of a rule", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(conditionNode({ field: "source", op: "in", values: ["src-gmb"] }));
    await settle();

    await user.click(screen.getByLabelText("Condition value"));
    await user.click(await screen.findByRole("option", { name: "Yelp" }));

    expect(panel.node().condition).toEqual({
      field: "source",
      op: "in",
      values: ["src-gmb", "src-yelp"],
      labels: ["GMB", "Yelp"],
    });
  });

  it("changes the property and forgets values that belonged to the old one", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(conditionNode({ field: "tag", op: "in", values: [TAG_ID] }));
    await settle();

    await user.click(screen.getByLabelText("Condition property"));
    await user.click(screen.getByRole("option", { name: "Source" }));

    // A tag id is not a source id; keeping it would narrow on nonsense.
    expect(panel.node().condition).toEqual({ field: "source", op: "in" });
  });

  it("offers a property the menu does not, when the rule already holds one", async () => {
    renderNodePanel(conditionNode({ field: "priority", op: "eq", values: ["high"] }));
    await settle();

    // Eight of the spec's seventeen fields are worth offering; a rule imported
    // with one of the other nine still has to be readable here.
    expect(screen.getByLabelText("Condition property")).toHaveTextContent("Priority");
  });
});

describe("the operator switch", () => {
  it("keeps a one-value condition one-value and a list a list", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(conditionNode({ field: "tag", op: "eq", values: [TAG_ID] }));
    await settle();

    await user.click(screen.getByRole("radio", { name: "is not" }));
    // `eq` becomes `ne`, not `not_in`: which of the pair a row uses is how the
    // engine reads it, and rewriting it is a change nobody asked for.
    expect(panel.node().condition).toEqual({ field: "tag", op: "ne", values: [TAG_ID] });

    await user.click(screen.getByRole("radio", { name: "is" }));
    expect(panel.node().condition).toEqual({ field: "tag", op: "eq", values: [TAG_ID] });
  });

  it("turns a list negative without collapsing it", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(
      conditionNode({ field: "source", op: "in", values: ["src-gmb", "src-yelp"] }),
    );
    await settle();

    await user.click(screen.getByRole("radio", { name: "is not" }));
    expect(panel.node().condition).toEqual({
      field: "source",
      op: "not_in",
      values: ["src-gmb", "src-yelp"],
    });
  });

  it("hides the values 'is set' has no use for, and hands them back", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(conditionNode({ field: "tag", op: "in", values: [TAG_ID] }));
    await settle();

    await user.click(screen.getByRole("radio", { name: "is set" }));
    expect(screen.queryByLabelText("Condition value")).toBeNull();
    // Carried rather than dropped, exactly as the old editor carried them
    // (`toCondition` in schemas.ts stores whatever values a row holds): the
    // engine ignores them here, and flipping the operator back has to return
    // the chips somebody picked rather than an empty row.
    expect(panel.node().condition).toEqual({ field: "tag", op: "exists", values: [TAG_ID] });

    await user.click(screen.getByRole("radio", { name: "is" }));
    expect(screen.getByLabelText("Condition value")).toHaveTextContent("SCHEDULED");
    expect(panel.node().condition).toEqual({ field: "tag", op: "in", values: [TAG_ID] });
  });

  it("promotes 'is' to a list the moment a second value is picked", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(conditionNode({ field: "tag", op: "eq", values: [TAG_ID] }));
    await settle();

    await user.click(screen.getByLabelText("Condition value"));
    await user.click(await screen.findByRole("option", { name: "URGENT" }));

    // `eq` reads `values[0]` and ignores the rest, so a row left at `eq` would
    // quietly drop what was just added.
    expect(panel.node().condition).toEqual({
      field: "tag",
      op: "in",
      values: [TAG_ID, SECOND_TAG_ID],
      labels: ["SCHEDULED", "URGENT"],
    });
  });
});

describe("'or' alternatives", () => {
  it("adds a second line under the first with 'or' between them", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(conditionNode({ field: "source", op: "in", values: ["src-gmb"] }));
    await settle();

    await user.click(screen.getByRole("button", { name: /Add 'or' condition/ }));

    expect(screen.getByText("or")).toBeInTheDocument();
    expect(screen.getByLabelText("Alternative 1 property")).toBeInTheDocument();
    expect(screen.getByLabelText("Alternative 2 property")).toBeInTheDocument();
    expect(panel.node().condition).toEqual({
      any: [
        { field: "source", op: "in", values: ["src-gmb"] },
        { field: "tag", op: "in" },
      ],
    });
  });

  it("edits one alternative without touching the other", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(
      conditionNode({
        any: [
          { field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] },
          { field: "source", op: "in", values: ["src-yelp"], labels: ["Yelp"] },
        ],
      }),
    );
    await settle();

    await user.click(screen.getByLabelText("Alternative 2 value"));
    await user.click(await screen.findByRole("option", { name: "GMB" }));

    expect(panel.node().condition).toEqual({
      any: [
        { field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] },
        { field: "source", op: "in", values: ["src-yelp", "src-gmb"], labels: ["Yelp", "GMB"] },
      ],
    });
  });

  it("removes an alternative and leaves the group a group", async () => {
    const user = userEvent.setup();
    const panel = renderNodePanel(
      conditionNode({
        any: [
          { field: "source", op: "in", values: ["src-gmb"] },
          { field: "source", op: "in", values: ["src-yelp"] },
        ],
      }),
    );
    await settle();

    await user.click(screen.getByRole("button", { name: "Remove alternative 2" }));
    expect(panel.node().condition).toEqual({ any: [{ field: "source", op: "in", values: ["src-gmb"] }] });
    // The last one cannot be removed from here — a node is deleted from its
    // own card, and an `{any: []}` holds for nothing.
    expect(screen.queryByRole("button", { name: /Remove alternative/ })).toBeNull();
  });
});

describe("a condition that narrows nothing", () => {
  it("says so, on the line it is true of", async () => {
    const user = userEvent.setup();
    renderNodePanel(conditionNode({ field: "tag", op: "in", values: [TAG_ID] }));
    await settle();

    expect(screen.queryByText(/narrows nothing/)).toBeNull();

    await user.click(screen.getByLabelText("Condition value"));
    await user.click(await screen.findByRole("option", { name: "SCHEDULED" }));

    expect(screen.getByText(/narrows nothing/)).toBeInTheDocument();
  });
});
