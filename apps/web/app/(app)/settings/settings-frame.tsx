"use client";

import { usePathname } from "next/navigation";
import { SettingsSidebar } from "./settings-sidebar";
import { settingsFrame } from "./sections";

/**
 * The frame round a settings page. Workiz's settings have no rail: the
 * settings home leads to every page, and each page draws itself edge to edge
 * under its own grey band (`WzSettingsHeader`). Those pages get nothing from
 * here. A page not rebuilt that way yet keeps the old frame — the "Settings"
 * heading over a left rail — until its rebuild adds it to
 * `WORKIZ_FRAMED_SETTINGS`.
 */
export function SettingsFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const frame = settingsFrame(pathname);

  if (frame === "workiz") {
    return <div className="flex min-w-0 flex-1 flex-col">{children}</div>;
  }
  // The template editor: no heading, no rail, and held to the window's
  // height so its paper and panel scroll inside it.
  if (frame === "editor") {
    return (
      <div data-frame="editor" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure workspace-wide options.</p>
      </div>
      <div className="flex flex-1 flex-col gap-6 px-6 py-5 md:flex-row">
        <SettingsSidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
