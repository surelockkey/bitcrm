import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ConditionNodeValues } from "../schemas";
import { AutomationConditionsField } from "./automation-conditions-field";
import { AutomationValuePicker, type PickerOption } from "./automation-value-picker";

/**
 * The two controls the rule editor asks its hardest questions through: the
 * chips that let one rule hold the values 24 copies of it used to, and the
 * "any of" group 25 imported rules carry.
 *
 * They used to be exercised through `automation-form-dialog`, which the node
 * builder replaced. The components did not change with it — only the screen
 * that mounts them — so the cases that were about the controls themselves are
 * asked here, of the controls themselves, rather than left to whichever panel
 * ends up rendering them.
 */

const SOURCES: PickerOption[] = [
  { id: "src-gmb", name: "GMB" },
  { id: "src-yelp", name: "Yelp" },
  { id: "src-fb", name: "Facebook" },
];

function Picker({
  options = SOURCES,
  start = [],
  labels,
  single,
}: {
  options?: PickerOption[];
  start?: string[];
  labels?: string[];
  single?: boolean;
}) {
  const [values, setValues] = useState(start);
  const [names, setNames] = useState<string[]>(labels ?? []);
  return (
    <>
      <AutomationValuePicker
        label="Source"
        options={options}
        values={values}
        labels={names}
        single={single}
        placeholder="Any source"
        onChange={(next, picked) => {
          setValues(next);
          setNames(picked);
        }}
      />
      <output data-testid="values">{JSON.stringify(values)}</output>
    </>
  );
}

describe("the value picker's accessible name", () => {
  it("says the placeholder when nothing is picked", () => {
    render(<Picker />);
    expect(screen.getByLabelText("Source")).toHaveAccessibleName("Source Any source");
  });

  it("says the one value that is picked", () => {
    render(<Picker start={["src-gmb"]} />);
    expect(screen.getByLabelText("Source")).toHaveAccessibleName("Source GMB");
  });

  it("says every value that is picked, not just that there are chips", () => {
    render(<Picker start={["src-gmb", "src-yelp"]} />);
    expect(screen.getByLabelText("Source")).toHaveAccessibleName("Source GMB, Yelp");
  });
});

describe("the value picker's list", () => {
  it("lets the keyboard drop a value the catalog cannot name", async () => {
    const user = userEvent.setup();
    // What the Workiz import leaves behind: an ad-group id no catalog here
    // holds. The chip's × is a pointer shortcut, so the list is the whole
    // keyboard path and has to offer it.
    render(<Picker start={["src-gmb", "adgroup:9912"]} labels={["GMB", "adgroup:9912"]} />);

    await user.click(screen.getByLabelText("Source"));
    await user.keyboard("adgroup");
    expect(await screen.findByRole("option", { name: /adgroup:9912\s*select to drop/ })).toBeInTheDocument();
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("values")).toHaveTextContent('["src-gmb"]');
  });

  it("calls nothing missing while the catalog behind the list is still on the wire", async () => {
    const user = userEvent.setup();
    render(<Picker options={[]} start={["src-gmb"]} labels={["GMB"]} />);

    await user.click(screen.getByLabelText("Source"));
    // An empty list is a list that has not arrived, not a list that lost this
    // value — calling it missing would drop a live source on the next press.
    expect(screen.queryByText("Picked, but not offered here")).not.toBeInTheDocument();
  });

  it("offers a one-value condition its own value as the way to empty it", async () => {
    const user = userEvent.setup();
    render(<Picker single start={["src-gmb"]} labels={["GMB"]} />);

    await user.click(screen.getByLabelText("Source"));
    await user.click(await screen.findByRole("option", { name: /GMB\s*select to drop/ }));
    expect(screen.getByTestId("values")).toHaveTextContent("[]");

    // And another value is still a straight swap, not a second chip.
    await user.click(screen.getByLabelText("Source"));
    await user.click(await screen.findByRole("option", { name: "Yelp" }));
    await user.click(screen.getByLabelText("Source"));
    await user.click(await screen.findByRole("option", { name: "Facebook" }));
    expect(screen.getByTestId("values")).toHaveTextContent('["src-fb"]');
  });
});

function Conditions({ start }: { start: ConditionNodeValues[] }) {
  const [conditions, setConditions] = useState(start);
  return (
    <>
      <AutomationConditionsField
        conditions={conditions}
        onChange={setConditions}
        optionsFor={() => SOURCES}
      />
      <output data-testid="conditions">{JSON.stringify(conditions)}</output>
    </>
  );
}

describe("the conditions field", () => {
  it('shows an imported "any of" group instead of hiding it', () => {
    render(
      <Conditions
        start={[
          {
            any: [
              { field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] },
              { field: "source", op: "in", values: ["src-yelp"], labels: ["Yelp"] },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("Any one of these")).toBeInTheDocument();
    expect(screen.getByLabelText("Condition 1 option 1 value")).toHaveTextContent("GMB");
    expect(screen.getByLabelText("Condition 1 option 2 value")).toHaveTextContent("Yelp");
  });

  it("adds an alternative to a plain condition, and drops the group with its last one", async () => {
    const user = userEvent.setup();
    render(<Conditions start={[{ field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] }]} />);

    await user.click(screen.getByRole("button", { name: "Add an alternative to condition 1" }));
    expect(screen.getByText("Any one of these")).toBeInTheDocument();
    expect(screen.getByTestId("conditions")).toHaveTextContent('"any"');

    await user.click(screen.getByRole("button", { name: "Remove condition 1 option 2" }));
    await user.click(screen.getByRole("button", { name: "Remove condition 1 option 1" }));
    // An `{any: []}` holds for nothing, so the group goes with its last
    // alternative rather than switching the rule off in silence.
    expect(screen.getByTestId("conditions")).toHaveTextContent("[]");
    expect(screen.queryByText("Any one of these")).not.toBeInTheDocument();
  });

  it('keeps one value when a condition becomes an "is", where the engine reads one', async () => {
    const user = userEvent.setup();
    render(
      <Conditions
        start={[{ field: "source", op: "in", values: ["src-gmb", "src-yelp"], labels: ["GMB", "Yelp"] }]}
      />,
    );

    await user.click(screen.getByLabelText("Condition 1 operator"));
    // "is", not "is one of" or "is not" — a name given as a string matches the
    // whole accessible name.
    await user.click(await screen.findByRole("option", { name: "is" }));

    expect(screen.getByTestId("conditions")).toHaveTextContent('"values":["src-gmb"]');
    expect(screen.getByTestId("conditions")).toHaveTextContent('"labels":["GMB"]');
  });

  it("says so when a condition is emptied, instead of dropping it in silence", async () => {
    const user = userEvent.setup();
    render(<Conditions start={[{ field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] }]} />);

    expect(screen.queryByText(/narrows nothing/)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Condition 1 value"));
    await user.click(await screen.findByRole("option", { name: "GMB" }));

    expect(screen.getByText(/narrows nothing and is not saved with the rule/)).toBeInTheDocument();
  });

  it("forgets the values of the field it no longer asks about", async () => {
    const user = userEvent.setup();
    render(<Conditions start={[{ field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] }]} />);

    await user.click(screen.getByLabelText("Condition 1 field"));
    await user.click(await screen.findByRole("option", { name: "Job tag" }));

    // Source ids under a tag condition would compare a tag with a source and
    // never hold — the row starts empty instead.
    expect(screen.getByTestId("conditions")).toHaveTextContent('"values":[]');
    expect(screen.getByTestId("conditions")).not.toHaveTextContent("src-gmb");
  });
});
