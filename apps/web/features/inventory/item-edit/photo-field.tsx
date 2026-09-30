"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { Folder, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { WzConfirm } from "./wz";
import { workizFont } from "./workiz-font";

/** What the popup will do to the photo on Save. */
export interface PhotoChange {
  /** A picked file, uploaded after the item is saved. */
  file?: File;
  /** The stored photo is to go. */
  remove?: boolean;
}

/** An object URL for a picked file, revoked when it changes or the field leaves. */
function usePreview(file?: File): string | undefined {
  const url = useMemo(
    () => (file && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : undefined),
    [file],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

/**
 * Workiz's 113px item photo. With a photo: the picture and a yellow pencil in
 * the lower-left corner that opens "Upload from computer" / "Delete". Without
 * one: the dark "Upload Image" tile with a yellow +. Nothing is sent until the
 * item's Save — Cancel leaves the stored photo as it was.
 */
export function PhotoField({
  name,
  storedUrl,
  loading = false,
  change,
  onChange,
  disabled = false,
}: {
  /** The item's name, for the picture's alt text. */
  name: string;
  /** The stored photo's download URL, when the item has one. */
  storedUrl?: string;
  loading?: boolean;
  change: PhotoChange;
  onChange: (change: PhotoChange) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = usePreview(change.file);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const shown = preview ?? (change.remove ? undefined : storedUrl);
  const pick = () => inputRef.current?.click();

  return (
    <div data-testid="photo-field" className="relative size-[113px] flex-none">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        data-testid="photo-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onChange({ file });
          e.target.value = "";
        }}
      />
      {shown ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown} alt={name || "Item photo"} className="size-full rounded-[4px] object-cover" />
          {disabled ? null : (
            <MenuPrimitive.Root modal={false}>
              <MenuPrimitive.Trigger
                aria-label="Change photo"
                className="absolute top-[81px] left-2 flex size-6 items-center justify-center rounded-full bg-[#fad400] text-[#404040] outline-none hover:bg-[#eac300] focus-visible:ring-2 focus-visible:ring-[#3b4b52]/40"
              >
                <Pencil className="size-3.5" strokeWidth={2} />
              </MenuPrimitive.Trigger>
              <MenuPrimitive.Portal>
                <MenuPrimitive.Content
                  align="start"
                  sideOffset={4}
                  className={cn(
                    workizFont.className,
                    "z-[60] min-w-[232px] rounded-lg bg-white py-2 text-[13px] leading-[19px] tracking-[0.4px] text-[#3b4b52] shadow-[0_2px_12px_rgba(0,0,0,0.16)]",
                  )}
                >
                  <MenuPrimitive.Item
                    onSelect={pick}
                    className="flex h-[35px] cursor-pointer items-center gap-2 px-6 outline-none data-highlighted:bg-[#f3f6f7]"
                  >
                    <Folder className="size-4" strokeWidth={1.5} />
                    Upload from computer
                  </MenuPrimitive.Item>
                  <MenuPrimitive.Item
                    onSelect={() => setConfirmDelete(true)}
                    className="flex h-[35px] cursor-pointer items-center gap-2 px-6 outline-none data-highlighted:bg-[#f3f6f7]"
                  >
                    <Trash2 className="size-4" strokeWidth={1.5} />
                    Delete
                  </MenuPrimitive.Item>
                </MenuPrimitive.Content>
              </MenuPrimitive.Portal>
            </MenuPrimitive.Root>
          )}
        </>
      ) : loading ? (
        <div className="flex size-full items-center justify-center rounded-[4px] bg-[#f3f6f7] text-[#9ea6aa]">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={pick}
          aria-label="Upload Image"
          className="relative flex size-full items-center justify-center overflow-hidden rounded-[4px] bg-[#3b4b52] text-center outline-none focus-visible:ring-2 focus-visible:ring-[#fad400] disabled:cursor-not-allowed"
        >
          {/* The placeholder picture behind the words: a sun and a hill. */}
          <span aria-hidden className="absolute top-3 left-3 size-[30px] rounded-full bg-[#4f5d63]" />
          <span
            aria-hidden
            className="absolute -bottom-[40px] left-[30px] size-[100px] rotate-45 rounded-[6px] bg-[#4f5d63]"
          />
          <span className="relative text-[14px] leading-[21px] font-semibold tracking-[0.4px] text-white">
            Upload
            <br />
            Image
          </span>
          <span
            aria-hidden
            className="absolute top-[81px] left-2 flex size-6 items-center justify-center rounded-full bg-[#fad400] text-[#404040]"
          >
            <Plus className="size-4" strokeWidth={2} />
          </span>
        </button>
      )}
      <WzConfirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete Image"
        message="Are you sure you want to delete this image?"
        onConfirm={() => {
          setConfirmDelete(false);
          onChange({ remove: true });
        }}
      />
    </div>
  );
}
