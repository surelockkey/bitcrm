"use client";

import { Plus, Trash2 } from "lucide-react";
import type { AutomationLabelMap } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isConditionGroupValues,
  type ConditionNodeValues,
  type ConditionValues,
} from "../schemas";
import { AutomationEmptyNote } from "./automation-empty-note";
import { AutomationValuePicker, type PickerOption } from "./automation-value-picker";

export const CONDITION_FIELD_LABEL: Record<string, string> = {
  status: "Job status",
  subStatus: "Sub-status",
  tag: "Job tag",
  source: "Source",
  jobType: "Job type",
  serviceArea: "Service area",
  hasTechs: "Technician assigned",
  isLead: "Is a job",
};

/**
 * What to call a field the menu above does not offer. Eight of the spec's
 * seventeen condition fields are offerable here; the rest exist in stored
 * rules (an imported `callStatus`, a `priority`) and a row showing one has
 * to be able to name it rather than render blank.
 */
export function conditionFieldLabel(field: string): string {
  const known = CONDITION_FIELD_LABEL[field];
  if (known) return known;
  const words = field.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : field;
}

const OP_LABEL: Record<string, string> = {
  in: "is one of",
  not_in: "is not one of",
  eq: "is",
  ne: "is not",
  exists: "is set",
  not_exists: "is not set",
};

const EMPTY_ROW: ConditionValues = { field: "tag", op: "in", values: [] };

/** `eq` / `ne` compare one value — the engine reads `values[0]` and ignores the rest. */
export const isSingleValueOp = (op: string) => op === "eq" || op === "ne";
/** `exists` / `not_exists` narrow with no value at all, so they are asked about the operator. */
export const opTakesValues = (op: string) => op !== "exists" && op !== "not_exists";

const isSingle = isSingleValueOp;
const hasValues = opTakesValues;

/**
 * A line with nothing picked narrows nothing, so `toSpec` does not store it —
 * the evaluator reads an empty `in` as "this field is not narrowed" and the
 * rule would fire for everything. `exists` / `not_exists` narrow with no
 * value at all, which is why they are asked about the operator and not the
 * chips.
 */
export const narrowsNothing = (c: ConditionValues) => hasValues(c.op) && c.values.length === 0;

/**
 * "And only if" — the AND list, where a row may itself be an "any of" group
 * (Workiz's OR, §1.5.4). 25 of the imported rules carry one and the engine
 * has always honoured it; until now the editor kept groups only by splicing
 * them back unseen, so the one thing a dispatcher could not do was read the
 * rule they were editing.
 */
export function AutomationConditionsField({
  conditions,
  onChange,
  optionsFor,
  labels,
}: {
  conditions: ConditionNodeValues[];
  onChange: (conditions: ConditionNodeValues[]) => void;
  optionsFor: (field: string) => PickerOption[];
  labels?: AutomationLabelMap;
}) {
  const replace = (index: number, node: ConditionNodeValues) =>
    onChange(conditions.map((c, i) => (i === index ? node : c)));

  const removeNode = (index: number) => onChange(conditions.filter((_, i) => i !== index));

  /** One "field / operator / value" line, wherever it sits. */
  const row = (condition: ConditionValues, name: string, set: (next: ConditionValues) => void) => {
    const options = optionsFor(condition.field);
    const single = isSingle(condition.op);
    return (
      <>
        <Select
          value={condition.field}
          onValueChange={(v) =>
            set({ ...condition, field: v as ConditionValues["field"], values: [], labels: undefined })
          }
        >
          <SelectTrigger className="w-44" aria-label={`${name} field`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CONDITION_FIELD_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={condition.op}
          onValueChange={(v) => {
            const op = v as ConditionValues["op"];
            // "is" takes one value; dropping the rest here rather than at save
            // means the row shows what the rule will actually match on.
            const values = isSingle(op) ? condition.values.slice(0, 1) : condition.values;
            set({ ...condition, op, values, labels: condition.labels?.slice(0, values.length) });
          }}
        >
          <SelectTrigger className="w-36" aria-label={`${name} operator`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(OP_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasValues(condition.op) ? (
          <AutomationValuePicker
            className="w-64"
            label={`${name} value`}
            options={options}
            values={condition.values}
            labels={condition.labels}
            fallback={labels}
            single={single}
            placeholder={single ? "Pick one" : "Pick one or more"}
            emptyText="Nothing to pick here yet"
            onChange={(values, names) => set({ ...condition, values, labels: names })}
          />
        ) : null}
      </>
    );
  };

  return (
    <div className="space-y-3">
      {conditions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No conditions — the trigger alone fires this rule.</p>
      ) : null}

      {conditions.map((node, index) => {
        const name = `Condition ${index + 1}`;
        if (!isConditionGroupValues(node)) {
          return (
            <div key={index} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {row(node, name, (next) => replace(index, next))}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Add an alternative to condition ${index + 1}`}
                  onClick={() => replace(index, { any: [node, { ...EMPTY_ROW }] })}
                >
                  + or
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove condition ${index + 1}`}
                  onClick={() => removeNode(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {narrowsNothing(node) ? <AutomationEmptyNote /> : null}
            </div>
          );
        }

        const setOption = (option: number, next: ConditionValues) =>
          replace(index, { any: node.any.map((c, i) => (i === option ? next : c)) });
        const removeOption = (option: number) => {
          const any = node.any.filter((_, i) => i !== option);
          // The last alternative gone, the group goes with it: an `{any: []}`
          // holds for nothing, and a rule that silently stopped firing is
          // worse than one that lost a condition in plain sight.
          if (!any.length) removeNode(index);
          else replace(index, { any });
        };

        return (
          <div key={index} className="space-y-2 rounded-md border border-dashed p-3">
            <p className="text-xs font-medium text-muted-foreground">Any one of these</p>
            {node.any.map((option, j) => (
              <div key={j} className="space-y-2">
                {j > 0 ? <p className="text-xs font-medium text-muted-foreground">or</p> : null}
                <div className="flex flex-wrap items-center gap-2">
                  {row(option, `${name} option ${j + 1}`, (next) => setOption(j, next))}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove condition ${index + 1} option ${j + 1}`}
                    onClick={() => removeOption(j)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {narrowsNothing(option) ? <AutomationEmptyNote /> : null}
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              aria-label={`Add an alternative to condition ${index + 1}`}
              onClick={() => replace(index, { any: [...node.any, { ...EMPTY_ROW }] })}
            >
              <Plus className="size-4" /> or
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export { EMPTY_ROW as EMPTY_CONDITION };
