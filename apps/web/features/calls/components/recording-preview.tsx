"use client";

import { Loader2, Mic } from "lucide-react";
import { useRecordingUrl } from "../use-recording-url";

/**
 * Compact inline player for the call log: lets a dispatcher listen to a
 * recording right in the list, Workiz-style, without opening the call page.
 * Mounted only while its row's preview is open, so the audio (and the
 * download) stops the moment it's closed or another preview starts.
 */
export function RecordingPreview({ callSid }: { callSid: string }) {
  const { url, error } = useRecordingUrl(callSid, true);

  if (error)
    return (
      <p className="text-sm text-red-500">Couldn&apos;t load the recording.</p>
    );
  if (!url)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading recording…
      </p>
    );
  return (
    <div className="flex items-center gap-3">
      <Mic className="size-4 shrink-0 text-muted-foreground" />
      <audio
        controls
        autoPlay
        src={url}
        data-testid="recording-audio"
        className="h-9 w-full max-w-xl"
      />
    </div>
  );
}
