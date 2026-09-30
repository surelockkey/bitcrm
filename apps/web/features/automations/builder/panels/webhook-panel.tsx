"use client";

import { useRef, useState } from "react";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import type { AutomationAction } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ChainNode } from "../types";
import { PanelField, PanelSection, SegmentedControl } from "./controls";

interface HeaderRow {
  /** Stable while this panel is open, so a row keeps its focus as its key is typed. */
  id: string;
  key: string;
  value: string;
}

const rowsOfHeaders = (headers: Record<string, string> | undefined): HeaderRow[] =>
  Object.entries(headers ?? {}).map(([key, value], i) => ({ id: `h${i}`, key, value }));

/** Whether a payload will survive the trip — `{{short_codes}}` inside strings parse fine. */
function payloadProblem(payload: string | undefined): string | null {
  if (!payload?.trim()) return null;
  try {
    JSON.parse(payload);
    return null;
  } catch {
    return "This is not valid JSON. It will be posted exactly as written — check it against what the other end expects.";
  }
}

/**
 * "Post a webhook" (§5.4). The URL, the method, the headers and the body: all
 * four have always been on the action and none of them was ever shown. The
 * old editor read them in `specToForm` and wrote them back in `toSpec` purely
 * so that editing a rule's message would not quietly turn its PUT into a
 * POST and drop its auth header (schemas.ts).
 *
 * They are editable here, and the two that can break a rule say so rather
 * than refusing: a URL without a scheme and a body that is not JSON are
 * warnings, because the editor is not the thing that knows what the other end
 * accepts.
 */
export function WebhookPanel({
  node,
  onChange,
  disabled,
}: {
  node: ChainNode;
  onChange: (next: ChainNode) => void;
  disabled?: boolean;
}) {
  const action: AutomationAction = node.action ?? { type: "webhook" };
  const [rows, setRows] = useState<HeaderRow[]>(() => rowsOfHeaders(action.headers));
  // Open on a rule that already has them, shut on one that does not: a
  // webhook with an auth header must never look like a webhook without one.
  const [open, setOpen] = useState(
    () => Boolean(Object.keys(action.headers ?? {}).length || action.payload),
  );
  const nextId = useRef(rows.length);

  const emit = (next: AutomationAction) => onChange({ ...node, action: { ...next, type: "webhook" } });

  const commitHeaders = (next: HeaderRow[]) => {
    setRows(next);
    const headers: Record<string, string> = {};
    // A row with no name is a row still being typed, not a header. The name is
    // stored exactly as it reads — trimming it here would rewrite somebody
    // else's header the first time an unrelated one was edited.
    for (const row of next) if (row.key.trim()) headers[row.key] = row.value;
    const built: AutomationAction = { ...action };
    if (Object.keys(headers).length) built.headers = headers;
    else delete built.headers;
    emit(built);
  };

  const url = action.url ?? "";
  const badUrl = url.trim().length > 0 && !/^https?:\/\//i.test(url.trim());
  const payloadNote = payloadProblem(action.payload);

  return (
    <div className="space-y-5">
      <PanelField label="URL">
        {(id) => (
          <Input
            id={id}
            placeholder="https://example.com/hook"
            disabled={disabled}
            value={url}
            onChange={(e) => emit({ ...action, url: e.target.value })}
          />
        )}
      </PanelField>

      {badUrl ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          A webhook URL has to start with http:// or https:// — the rule cannot be saved until it
          does.
        </p>
      ) : null}

      <PanelSection title="Method">
        <SegmentedControl
          label="HTTP method"
          value={action.method ?? "POST"}
          options={[
            { id: "POST", label: "POST" },
            { id: "PUT", label: "PUT" },
          ]}
          disabled={disabled}
          onChange={(method) => emit({ ...action, method })}
        />
      </PanelSection>

      <div className="space-y-3 border-t pt-3">
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          Headers and body
        </button>

        {open ? (
          <div className="space-y-4">
            <PanelSection
              title="Headers"
              hint="Sent with every call — an API key, a content type, whatever the other end asks for."
            >
              <div className="space-y-2">
                {rows.map((row, index) => (
                  <div key={row.id} className="flex flex-wrap items-center gap-2">
                    <Input
                      className="w-44"
                      placeholder="Authorization"
                      aria-label={`Header ${index + 1} name`}
                      disabled={disabled}
                      value={row.key}
                      onChange={(e) =>
                        commitHeaders(rows.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r)))
                      }
                    />
                    <Input
                      className="min-w-40 flex-1"
                      placeholder="Bearer …"
                      aria-label={`Header ${index + 1} value`}
                      disabled={disabled}
                      value={row.value}
                      onChange={(e) =>
                        commitHeaders(
                          rows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove header ${index + 1}`}
                      disabled={disabled}
                      onClick={() => commitHeaders(rows.filter((r) => r.id !== row.id))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                {rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No headers.</p>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    nextId.current += 1;
                    setRows([...rows, { id: `h${nextId.current}-new`, key: "", value: "" }]);
                  }}
                >
                  <Plus className="size-4" /> Header
                </Button>
              </div>
            </PanelSection>

            <PanelField
              label="Body"
              hint="JSON, with {{short_codes}} inside the strings. Left empty, the engine posts the event and the job."
            >
              {(id) => (
                <Textarea
                  id={id}
                  className="min-h-32 font-mono text-xs"
                  placeholder={'{"job": "{{job_id}}"}'}
                  disabled={disabled}
                  value={action.payload ?? ""}
                  onChange={(e) => {
                    const built: AutomationAction = { ...action };
                    if (e.target.value) built.payload = e.target.value;
                    else delete built.payload;
                    emit(built);
                  }}
                />
              )}
            </PanelField>

            {payloadNote ? (
              <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                {payloadNote}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
