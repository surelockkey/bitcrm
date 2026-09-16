"use client";

import { useRef, useState } from "react";
import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAttachments, useUploadAttachment } from "@/features/deals/attachments-hooks";

/**
 * Photos are the technician's paperwork: the meter before, the leak after,
 * the model plate they'll be asked about next week. Two ways in, because a
 * phone has two — the camera (`capture` opens it straight away on iOS and
 * Android) and the gallery, for the shot taken before the app was open.
 *
 * Uploads go through the job's existing attachments API, so anything added
 * here is on the job in the office a second later.
 */
export function TechPhotoCapture({ dealId }: { dealId: string }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [queued, setQueued] = useState(0);
  const upload = useUploadAttachment(dealId);
  const { data: attachments } = useAttachments(dealId);
  const photos = (attachments ?? []).filter((a) => a.contentType?.startsWith("image/"));

  const send = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setQueued((n) => n + list.length);
    for (const file of list) {
      upload.mutate(
        { file, category: "photo" },
        { onSettled: () => setQueued((n) => Math.max(0, n - 1)) },
      );
    }
  };

  return (
    <div className="space-y-2" data-testid="tech-photos">
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-12 flex-1 gap-2 rounded-xl"
          disabled={queued > 0}
          onClick={() => cameraRef.current?.click()}
        >
          {queued > 0 ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
          {queued > 0 ? `Uploading ${queued}…` : "Take photo"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 flex-1 gap-2 rounded-xl"
          disabled={queued > 0}
          onClick={() => galleryRef.current?.click()}
        >
          <ImagePlus className="size-5" /> From gallery
        </Button>
      </div>

      {/* Two inputs, because `capture` cannot be toggled per click reliably. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Take a photo of the job"
        onChange={(e) => {
          send(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        aria-label="Add photos from the gallery"
        onChange={(e) => {
          send(e.target.files);
          e.target.value = "";
        }}
      />

      <p className="px-1 text-xs text-muted-foreground">
        {photos.length === 0
          ? "No photos on this job yet."
          : `${photos.length} photo${photos.length === 1 ? "" : "s"} on this job.`}
      </p>
    </div>
  );
}
