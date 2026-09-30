"use client";

import { Plus, Trash2 } from "lucide-react";
import {
  isAutomationConditionGroup,
  type AutomationCondition,
  type AutomationConditionNode,
  type AutomationLabelMap,
} from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { AutomationEmptyNote } from "../../components/automation-empty-note";
import {
  CONDITION_FIELD_LABEL,
  EMPTY_CONDITION,
  conditionFieldLabel,
  narrowsNothing,
  opTakesValues,
} from "../../components/automation-conditions-field";
import {
  AutomationValuePicker,
  type PickerOption,
} from "../../components/automation-value-picker";
import type { ConditionValues } from "../../schemas";
import type { ChainNode } from "../types";
import { useConditionCatalog } from "./catalog";
import { SegmentedControl, Slot, type SegmentOption } from "./controls";

/**
 * The four operators a reader has to choose between. The spec stores six:
 * `in` / `eq` are both "is" and `not_in` / `ne` both "is not", and which of
 * each pair a row uses is a question about how many values it holds, not a
 * question anybody should be asked. So the switch keeps whichever of the pair
 * the rule already had and the value picker moves a row between them — a
 * second value promotes `eq` to `in`, which is the only direction that can
 * mean anything.
 */
type OpChoice = "is" | "is_not" | "exists" | "not_exists";

const OP_CHOICES: Array<SegmentOption<OpChoice>> = [
  { id: "is", label: "is", symbol: "=" },
  { id: "is_not", label: "is not", symbol: "≠" },
  { id: "exists", label: "is set" },
  { id: "not_exists", label: "is not set" },
];

const choiceOf = (op: ConditionValues["op"]): OpChoice =>
  op === "in" || op === "eq" ? "is" : op === "not_in" || op === "ne" ? "is_not" : op;

/** The stored operator a choice means, keeping the row in the family it was written in. */
function opOf(choice: OpChoice, current: ConditionValues["op"]): ConditionValues["op"] {
  const one = current === "eq" || current === "ne";
  if (choice === "is") return one ? "eq" : "in";
  if (choice === "is_not") return one ? "ne" : "not_in";
  return choice;
}

/**
 * A row as the spec stores it — the same pruning `toSpec` does (schemas.ts
 * `toCondition`), so a condition written here is shaped like every condition
 * already in the workspace: no `values: []` on an `exists`, no empty `labels`.
 */
const toStored = (c: ConditionValues): AutomationCondition => ({
  field: c.field,
  op: c.op,
  ...(c.values.length ? { values: c.values } : {}),
  ...(c.labels?.length ? { labels: c.labels } : {}),
});

const toRow = (c: AutomationCondition): ConditionValues => ({
  field: c.field,
  op: c.op,
  values: c.values ?? [],
  labels: c.labels,
});

/** Every alternative of a node, in order; a plain condition is a list of one. */
function rowsOf(condition: AutomationConditionNode | undefined): ConditionValues[] {
  if (!condition) return [{ ...EMPTY_CONDITION }];
  return isAutomationConditionGroup(condition) ? condition.any.map(toRow) : [toRow(condition)];
}

/**
 * The "Only if" node (§5.2): `Select property`, the operator as a switch with
 * every choice in sight, and the value as chips — the control that turns 24
 * near-identical rules into one.
 *
 * `+ Add 'or' condition` puts a second line under the first with "or" between
 * them, and the node becomes one of the spec's `{any: [...]}` groups: 25 of
 * the imported rules already carry one, and the engine has always honoured it.
 */
export function ConditionPanel({
  node,
  labels,
  onChange,
  disabled,
}: {
  node: ChainNode;
  labels: AutomationLabelMap;
  onChange: (next: ChainNode) => void;
  disabled?: boolean;
}) {
  const catalog = useConditionCatalog();
  const rows = rowsOf(node.condition);
  const wasGroup = node.condition ? isAutomationConditionGroup(node.condition) : false;

  const commit = (next: ConditionValues[]) => {
    const stored = next.map(toStored);
    // One alternative is a plain condition unless the rule already spelled it
    // as a group — an `{any: [one]}` that was stored that way stays that way,
    // because rewriting a shape nobody asked about is how a diff gets noise.
    const condition: AutomationConditionNode =
      stored.length > 1 || wasGroup ? { any: stored } : stored[0];
    onChange({ ...node, condition });
  };

  const setRow = (index: number, row: ConditionValues) =>
    commit(rows.map((r, i) => (i === index ? row : r)));

  /**
   * The properties offered, plus whichever this row already holds. Eight of
   * the spec's seventeen fields are worth offering; a rule imported with one
   * of the other nine still has to be readable and editable rather than
   * showing an empty slot.
   */
  const fieldOptions = (field: string): PickerOption[] => {
    const offered = Object.keys(CONDITION_FIELD_LABEL);
    const all = offered.includes(field) ? offered : [...offered, field];
    return all.map((id) => ({ id, name: conditionFieldLabel(id) }));
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Checked before anything is sent, wherever this step sits in the chain.
      </p>

      {rows.map((row, index) => {
        const name = rows.length > 1 ? `Alternative ${index + 1}` : "Condition";
        const options = catalog.optionsFor(row.field);
        return (
          <div key={index} className="space-y-2">
            {index > 0 ? (
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">or</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Slot
                label={`${name} property`}
                value={row.field}
                options={fieldOptions(row.field)}
                placeholder="Select property"
                disabled={disabled}
                onChange={(field) =>
                  setRow(index, {
                    ...row,
                    field: field as ConditionValues["field"],
                    // The values belonged to the old field; a tag id is not a
                    // source id, and keeping them would narrow on nonsense.
                    values: [],
                    labels: undefined,
                  })
                }
              />
              {rows.length > 1 ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  aria-label={`Remove alternative ${index + 1}`}
                  disabled={disabled}
                  onClick={() => commit(rows.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>

            <SegmentedControl
              label={`${name} operator`}
              value={choiceOf(row.op)}
              options={OP_CHOICES}
              disabled={disabled}
              onChange={(choice) => {
                const op = opOf(choice, row.op);
                // "is" takes one value; dropping the rest here rather than at
                // save means the row shows what the rule will match on.
                const values = op === "eq" || op === "ne" ? row.values.slice(0, 1) : row.values;
                setRow(index, { ...row, op, values, labels: row.labels?.slice(0, values.length) });
              }}
            />

            {opTakesValues(row.op) ? (
              <AutomationValuePicker
                label={`${name} value`}
                options={options}
                values={row.values}
                labels={row.labels}
                fallback={labels}
                placeholder="Pick one or more"
                emptyText="Nothing to pick here yet"
                disabled={disabled}
                onChange={(values, names) => {
                  // A second value is what turns "is" into "is one of": the
                  // engine reads `values[0]` and ignores the rest on `eq`, so
                  // a row left at `eq` would quietly drop what was just added.
                  const op =
                    values.length > 1 && (row.op === "eq" || row.op === "ne")
                      ? row.op === "eq"
                        ? ("in" as const)
                        : ("not_in" as const)
                      : row.op;
                  setRow(index, { ...row, op, values, labels: names });
                }}
              />
            ) : null}

            {narrowsNothing(row) ? <AutomationEmptyNote /> : null}
          </div>
        );
      })}

      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => commit([...rows, { ...EMPTY_CONDITION }])}
      >
        <Plus className="size-4" /> Add &apos;or&apos; condition
      </Button>
    </div>
  );
}
