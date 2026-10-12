"use client";

import { useEffect, useState } from "react";
import { fetchRecordingBlob } from "./api";

/**
 * Loads a call recording as an object URL. The media endpoint needs the
 * Bearer header, which an <audio src> can't send — so the blob is fetched
 * with auth and played through an object URL (revoked on unmount).
 */
export function useRecordingUrl(callSid: string, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    fetchRecordingBlob(callSid)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e: unknown) => (cancelled ? undefined : setError(e instanceof Error ? e : new Error("Recording unavailable"))));

    return () => {
      cancelled = true;
      setUrl(null);
      setError(null);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [callSid, enabled]);

  return { url, error };
}
