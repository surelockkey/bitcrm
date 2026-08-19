"use client";

import { useRef } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CallFlowNode, CallGroupWithMembers } from "@bitcrm/types";
import { useUploadFlowAudio } from "../call-flows-hooks";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The settings one step needs — and nothing about what follows it, because
 * that is decided by where the step sits on the canvas.
 */
export function FlowStepFields({
  node,
  groups,
  onChange,
}: {
  node: CallFlowNode;
  groups: CallGroupWithMembers[];
  onChange: (node: CallFlowNode) => void;
}) {
  const upload = useUploadFlowAudio();
  const fileRef = useRef<HTMLInputElement>(null);

  const audioControls = (audioId: string | undefined, set: (id?: string) => void) => (
    <div className="flex flex-wrap items-center gap-2">
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
        <>
          <span className="text-xs text-muted-foreground">
            Plays instead of the text.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => set(undefined)}
          >
            Use the text
          </Button>
        </>
      ) : null}
    </div>
  );

  if (node.type === "say") {
    return (
      <div className="space-y-2">
        <Textarea
          rows={2}
          aria-label="What the caller hears"
          value={node.text}
          placeholder="Thanks for calling…"
          onChange={(e) => onChange({ ...node, text: e.target.value })}
        />
        {audioControls(node.audioId, (audioId) => onChange({ ...node, audioId }))}
      </div>
    );
  }

  if (node.type === "ring") {
    return (
      <div className="space-y-2">
        <div className="space-y-1">
          <Label className="text-xs">Call group</Label>
          <select
            aria-label="Call group"
            className="h-8 w-full rounded-md border bg-transparent px-2 text-xs"
            value={node.groupId}
            onChange={(e) => onChange({ ...node, groupId: e.target.value })}
          >
            <option value="">Pick a call group…</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} — {group.members.length} member
                {group.members.length === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!!node.whisper}
            onChange={(e) => onChange({ ...node, whisper: e.target.checked })}
          />
          <span>
            Make personal phones press a key first
            <span className="block text-muted-foreground">
              Stops a mobile&apos;s voicemail answering and taking the call from
              everyone else still ringing.
            </span>
          </span>
        </label>
      </div>
    );
  }

  if (node.type === "hours") {
    return (
      <div className="space-y-2.5">
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
      </div>
    );
  }

  if (node.type === "menu") {
    return (
      <div className="space-y-2.5">
        <Textarea
          rows={2}
          aria-label="What the caller hears"
          value={node.prompt}
          placeholder="Press 1 for a new job, 2 for an existing one."
          onChange={(e) => onChange({ ...node, prompt: e.target.value })}
        />
        {audioControls(node.audioId, (audioId) => onChange({ ...node, audioId }))}
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
                aria-label={`What key ${i + 1} is for`}
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
          <p className="text-xs text-muted-foreground">
            Each key gets its own path below.
          </p>
        </div>
      </div>
    );
  }

  if (node.type === "voicemail") {
    return (
      <div className="space-y-2">
        <Textarea
          rows={2}
          aria-label="What the caller hears"
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
      </div>
    );
  }

  return (
    <Textarea
      rows={2}
      aria-label="What the caller hears"
      value={node.text ?? ""}
      placeholder="Anything to say before hanging up (optional)"
      onChange={(e) => onChange({ ...node, text: e.target.value })}
    />
  );
}
