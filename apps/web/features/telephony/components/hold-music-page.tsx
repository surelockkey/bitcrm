"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_HOLD_SOUND_ID,
  PREMADE_HOLD_SOUNDS,
  type HoldSound,
} from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButton } from "@/components/workiz/button";
import { WzTabIntro } from "@/components/workiz/phone-tab-parts";
import { cn } from "@/lib/utils";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { useSetHoldSound, useTelephonyConfig } from "../config-hooks";
import { useUploadFlowAudio } from "../call-flows-hooks";
import { fetchFlowAudioBlob } from "../call-flows-api";

const INTRO =
  "What a caller hears while you have them on hold — pick a ready-made track or upload your own MP3 or WAV. " +
  "It plays on a loop, for every call, as soon as somebody presses Hold in the dialer.";

/** What a row previews: a public track's URL, or one of our uploads. */
type PreviewSource = { url: string; audioId?: undefined } | { url?: undefined; audioId: string };

/** One row's key: a premade id, or `custom:<audioId>`. */
type OptionKey = string;
const customKey = (audioId: string) => `custom:${audioId}`;

/**
 * Phone → Hold music (`/calls/hold-music`; Settings → Hold Music lands here).
 * The company's one choice, kept on telephony's settings row: the ready-made
 * tracks (Twilio's public hold-music library) and, once uploaded, the office's
 * own recording. Every option can be listened to first; picking one saves it
 * at once (`settings.edit` — everyone else can only listen).
 */
export function HoldMusicPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const denied = useDenied();
  const config = useTelephonyConfig();
  const save = useSetHoldSound();
  const upload = useUploadFlowAudio();
  const canEdit = can("settings", "edit");

  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const objectUrl = useRef<string | null>(null);
  const [playing, setPlaying] = useState<OptionKey | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<OptionKey | null>(null);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  const current: HoldSound | null = config.data?.holdSound ?? null;
  const selected: OptionKey =
    current?.kind === "custom" ? customKey(current.audioId) : (current?.id ?? DEFAULT_HOLD_SOUND_ID);

  if (denied("settings")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view the hold music.</p>
      </div>
    );
  }

  const stop = () => {
    audioRef.current?.pause();
    setPlaying(null);
  };

  /** Where a preview plays from: a public track, or an upload fetched as the signed-in user. */
  const resolveSource = async (source: PreviewSource): Promise<string> => {
    if (source.url) return source.url;
    const blob = await fetchFlowAudioBlob(source.audioId!);
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(blob);
    return objectUrl.current;
  };

  const preview = async (key: OptionKey, source: PreviewSource) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing === key) {
      stop();
      return;
    }
    audio.pause();
    setLoadingPreview(key);
    try {
      audio.src = await resolveSource(source);
      audio.loop = false;
      await audio.play();
      setPlaying(key);
    } catch {
      toast.error("Could not play that recording");
      setPlaying(null);
    } finally {
      setLoadingPreview(null);
    }
  };

  const options: { key: OptionKey; name: string; hint?: string; sound: HoldSound; source: PreviewSource }[] = [
    ...PREMADE_HOLD_SOUNDS.map((s) => ({
      key: s.id,
      name: s.name,
      hint: s.id === DEFAULT_HOLD_SOUND_ID ? "Default" : undefined,
      sound: { kind: "premade", id: s.id } as HoldSound,
      source: { url: s.url },
    })),
    ...(current?.kind === "custom"
      ? [
          {
            key: customKey(current.audioId),
            name: current.name,
            hint: "Your recording",
            sound: current,
            source: { audioId: current.audioId },
          },
        ]
      : []),
  ];

  const ready = !permissionsLoading && !config.isLoading;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <WzTabIntro
        action={
          ready && canEdit ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="audio/mpeg,audio/wav,audio/x-wav"
                aria-label="Upload a recording"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  upload.mutate(file, {
                    onSuccess: (audio) =>
                      save.mutate({ kind: "custom", audioId: audio.id, name: audio.name || file.name }),
                  });
                }}
              />
              <WzButton
                className="px-8"
                icon={upload.isPending ? <Loader2 className="animate-spin" /> : <Upload strokeWidth={1.5} />}
                disabled={upload.isPending}
                onClick={() => fileRef.current?.click()}
              >
                Upload your own
              </WzButton>
            </>
          ) : null
        }
      >
        {INTRO}
      </WzTabIntro>

      {/* One player for every preview: starting another stops the last. */}
      <audio ref={audioRef} className="hidden" onEnded={() => setPlaying(null)} />

      {!ready ? (
        <div className="px-10">
          <Skeleton className="h-[320px] w-full max-w-[660px] rounded-none" />
        </div>
      ) : (
        <div role="radiogroup" aria-label="Hold music" className="mx-10 max-w-[660px] divide-y border">
          {options.map((option) => {
            const isPlaying = playing === option.key;
            return (
              <label
                key={option.key}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 text-sm",
                  canEdit ? "cursor-pointer hover:bg-black/5" : "cursor-default",
                  selected === option.key && "bg-black/[0.03]",
                )}
              >
                <input
                  type="radio"
                  name="hold-music"
                  value={option.key}
                  aria-label={option.name}
                  checked={selected === option.key}
                  disabled={!canEdit || save.isPending}
                  onChange={() => save.mutate(option.sound)}
                  className="size-4 accent-foreground"
                />
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                {option.hint ? <span className="text-xs text-muted-foreground">{option.hint}</span> : null}
                <button
                  type="button"
                  aria-label={`${isPlaying ? "Stop" : "Play"} ${option.name}`}
                  className="inline-flex size-7 items-center justify-center rounded-full border text-foreground hover:bg-black/5"
                  onClick={(e) => {
                    // A preview is not a choice.
                    e.preventDefault();
                    void preview(option.key, option.source);
                  }}
                >
                  {loadingPreview === option.key ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="size-3.5" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                </button>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
