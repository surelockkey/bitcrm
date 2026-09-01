"use client";

import { Loader2, Mic } from "lucide-react";
import { useRecordingUrl } from "../use-recording-url";

/** Plays the call recording on the call detail page. */
export function RecordingPlayer({
  callSid,
  hasRecording,
}: {
  callSid: string;
  hasRecording: boolean;
}) {
  const { url, error } = useRecordingUrl(callSid, hasRecording);

  if (!hasRecording) {
    return (
      <p className="text-sm text-muted-foreground">
        No recording for this call
        {" — "}recordings appear a few seconds after a call ends.
      </p>
    );
  }
  if (error)
    return <p className="text-sm text-red-500">Couldn&apos;t load the recording.</p>;
  if (!url) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading recording…
      </p>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <Mic className="size-4 shrink-0 text-muted-foreground" />
      <audio controls src={url} className="h-10 w-full max-w-md" />
    </div>
  );
}
