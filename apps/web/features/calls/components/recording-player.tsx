"use client";

import { useEffect, useState } from "react";
import { Loader2, Mic } from "lucide-react";
import { fetchRecordingBlob } from "../api";

/**
 * Plays the call recording. The media endpoint needs the Bearer header, which
 * an <audio src> can't send — so the blob is fetched with auth and played
 * through an object URL (revoked on unmount).
 */
export function RecordingPlayer({
  callSid,
  hasRecording,
}: {
  callSid: string;
  hasRecording: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasRecording) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    fetchRecordingBlob(callSid)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() =>
        cancelled ? undefined : setError("Couldn't load the recording."),
      );

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [callSid, hasRecording]);

  if (!hasRecording) {
    return (
      <p className="text-sm text-muted-foreground">
        No recording for this call
        {" — "}recordings appear a few seconds after a call ends.
      </p>
    );
  }
  if (error) return <p className="text-sm text-red-500">{error}</p>;
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
