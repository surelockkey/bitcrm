"use client";

import { useRef } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CallFlowNode, CallGroupWithMembers } from "@bitcrm/types";
import { STEP_LABEL, blankStep } from "../flow-graph";
import { useUploadFlowAudio } from "../call-flows-hooks";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "…and then go to which step?" — the one control every branch needs. */
function NextPicker({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value?: string;
  options: CallFlowNode[];
  onPick: (id: string | undefined) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <select
        aria-label={label}
        className="h-8 w-full rounded-md border bg-transparent px-2 text-xs"
        value={value ?? ""}
        onChange={(e) => onPick(e.target.value || undefined)}
      >
        <option value="">End the call</option>
        {options.map((step) => (
          <option key={step.id} value={step.id}>
            {STEP_LABEL[step.type]}
            {step.type === "say" && step.text ? ` — ${step.text.slice(0, 24)}…` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

/** One step, with the fields its own type needs and nothing else. */
export function FlowStepCard({
  node,
  depth,
  branch,
  groups,
  steps,
  onChange,
  onRemove,
}: {
  node: CallFlowNode;
  depth: number;
  branch?: string;
  groups: CallGroupWithMembers[];
  /** Every step, for the "then go to" pickers. */
  steps: CallFlowNode[];
  onChange: (node: CallFlowNode) => void;
  onRemove: () => void;
}) {
  const upload = useUploadFlowAudio();
  const fileRef = useRef<HTMLInputElement>(null);

  const others = steps.filter((s) => s.id !== node.id);

  const audioButton = (audioId: string | undefined, set: (id?: string) => void) => (
    <div className="flex items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/x-wav"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file, { onSuccess: (a) => set(a.id) });
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        disabled={upload.isPending}
        onClick={() => fileRef.current?.click()}
      >
        {upload.isPending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Upload className="size-3" />
        )}
        {audioId ? "Replace recording" : "Upload a recording"}
      </Button>
      {audioId ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => set(undefined)}
        >
          Use the text instead
        </Button>
      ) : null}
    </div>
  );

  return (
    <div style={{ marginLeft: depth * 18 }} className="relative">
      {branch ? (
        <span className="mb-1 inline-block rounded-full border px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {branch}
        </span>
      ) : null}
      <div
        className={cn(
          "space-y-2.5 rounded-lg border p-3",
          branch === "Not reachable" && "border-dashed opacity-70",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{STEP_LABEL[node.type]}</span>
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${STEP_LABEL[node.type]}`}
            onClick={onRemove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>

        {node.type === "say" ? (
          <>
            <Textarea
              rows={2}
              value={node.text}
              placeholder="Thanks for calling…"
              onChange={(e) => onChange({ ...node, text: e.target.value })}
            />
            {audioButton(node.audioId, (audioId) => onChange({ ...node, audioId }))}
            {node.audioId ? (
              <p className="text-xs text-muted-foreground">
                The recording plays instead of the text.
              </p>
            ) : null}
            <NextPicker
              label="Then"
              options={others}
              value={node.next}
              onPick={(next) => onChange({ ...node, next })}
            />
          </>
        ) : null}

        {node.type === "ring" ? (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Ring</Label>
              <select
                aria-label="Ring"
                className="h-8 w-full rounded-md border bg-transparent px-2 text-xs"
                value={node.groupId}
                onChange={(e) => onChange({ ...node, groupId: e.target.value })}
              >
                <option value="">Pick a call group…</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={!!node.whisper}
                onChange={(e) => onChange({ ...node, whisper: e.target.checked })}
              />
              Make personal phones press a key first
            </label>
            {node.whisper ? (
              <p className="text-xs text-muted-foreground">
                Stops a mobile&apos;s voicemail answering and taking the call
                from everyone else still ringing.
              </p>
            ) : null}
            <NextPicker
              label="If nobody answers"
              options={others}
              value={node.next}
              onPick={(next) => onChange({ ...node, next })}
            />
          </>
        ) : null}

        {node.type === "hours" ? (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Timezone</Label>
              <Input
                aria-label="Timezone"
                className="h-8 text-xs"
                value={node.timezone}
                onChange={(e) => onChange({ ...node, timezone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Open</Label>
              {DAYS.map((label, day) => {
                const window = node.windows.find((w) => w.day === day);
                return (
                  <div key={day} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={!!window}
                      aria-label={label}
                      onChange={(e) =>
                        onChange({
                          ...node,
                          windows: e.target.checked
                            ? [...node.windows, { day, open: "08:00", close: "18:00" }]
                            : node.windows.filter((w) => w.day !== day),
                        })
                      }
                    />
                    <span className="w-9">{label}</span>
                    {window ? (
                      <>
                        <Input
                          type="time"
                          className="h-7 w-24 text-xs"
                          aria-label={`${label} open`}
                          value={window.open}
                          onChange={(e) =>
                            onChange({
                              ...node,
                              windows: node.windows.map((w) =>
                                w.day === day ? { ...w, open: e.target.value } : w,
                              ),
                            })
                          }
                        />
                        <span className="text-muted-foreground">to</span>
                        <Input
                          type="time"
                          className="h-7 w-24 text-xs"
                          aria-label={`${label} close`}
                          value={window.close}
                          onChange={(e) =>
                            onChange({
                              ...node,
                              windows: node.windows.map((w) =>
                                w.day === day ? { ...w, close: e.target.value } : w,
                              ),
                            })
                          }
                        />
                      </>
                    ) : (
                      <span className="text-muted-foreground">closed</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <NextPicker
                label="When open"
                options={others}
                value={node.openNext}
                onPick={(openNext) => onChange({ ...node, openNext })}
              />
              <NextPicker
                label="When closed"
                options={others}
                value={node.next}
                onPick={(next) => onChange({ ...node, next })}
              />
            </div>
          </>
        ) : null}

        {node.type === "menu" ? (
          <>
            <Textarea
              rows={2}
              value={node.prompt}
              placeholder="Press 1 for a new job, 2 for an existing one."
              onChange={(e) => onChange({ ...node, prompt: e.target.value })}
            />
            {audioButton(node.audioId, (audioId) => onChange({ ...node, audioId }))}
            <div className="space-y-1.5">
              <Label className="text-xs">Keys</Label>
              {node.options.map((option, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    className="h-8 w-12 text-center text-xs"
                    aria-label={`Key ${i + 1}`}
                    maxLength={1}
                    value={option.key}
                    onChange={(e) =>
                      onChange({
                        ...node,
                        options: node.options.map((o, j) =>
                          j === i ? { ...o, key: e.target.value } : o,
                        ),
                      })
                    }
                  />
                  <Input
                    className="h-8 flex-1 text-xs"
                    aria-label={`Label ${i + 1}`}
                    placeholder="What this key is for"
                    value={option.label}
                    onChange={(e) =>
                      onChange({
                        ...node,
                        options: node.options.map((o, j) =>
                          j === i ? { ...o, label: e.target.value } : o,
                        ),
                      })
                    }
                  />
                  <select
                    className="h-8 flex-1 rounded-md border bg-transparent px-2 text-xs"
                    aria-label={`Goes to ${i + 1}`}
                    value={option.next}
                    onChange={(e) =>
                      onChange({
                        ...node,
                        options: node.options.map((o, j) =>
                          j === i ? { ...o, next: e.target.value } : o,
                        ),
                      })
                    }
                  >
                    <option value="">Pick a step…</option>
                    {others.map((step) => (
                      <option key={step.id} value={step.id}>
                        {STEP_LABEL[step.type]}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Remove key ${i + 1}`}
                    onClick={() =>
                      onChange({
                        ...node,
                        options: node.options.filter((_, j) => j !== i),
                      })
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  onChange({
                    ...node,
                    options: [
                      ...node.options,
                      { key: String(node.options.length + 1), label: "", next: "" },
                    ],
                  })
                }
              >
                + Add a key
              </Button>
            </div>
            <NextPicker
              label="If they press nothing"
              options={others}
              value={node.next}
              onPick={(next) => onChange({ ...node, next })}
            />
          </>
        ) : null}

        {node.type === "voicemail" ? (
          <>
            <Textarea
              rows={2}
              value={node.prompt}
              placeholder="Please leave a message after the tone."
              onChange={(e) => onChange({ ...node, prompt: e.target.value })}
            />
            <div className="space-y-1">
              <Label className="text-xs">Stop recording after (seconds)</Label>
              <Input
                type="number"
                aria-label="Stop recording after (seconds)"
                className="h-8 w-28 text-xs"
                value={node.maxSeconds}
                onChange={(e) =>
                  onChange({ ...node, maxSeconds: Number(e.target.value) || 120 })
                }
              />
            </div>
          </>
        ) : null}

        {node.type === "hangup" ? (
          <Textarea
            rows={2}
            value={node.text ?? ""}
            placeholder="Anything to say before hanging up (optional)"
            onChange={(e) => onChange({ ...node, text: e.target.value })}
          />
        ) : null}
      </div>
    </div>
  );
}

export { blankStep };
