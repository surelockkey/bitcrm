"use client";

import { useEffect } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { WzSwitch } from "@/components/workiz/toggles";
import { useOnScreenStore } from "../on-screen-store";

export const ON_SCREEN_LABEL = "On-screen notifications";

/**
 * The first row of Workiz's avatar menu (uikit_wz_avatar_menu): a bell, "On-screen
 * notifications" and the 40×20 green toggle at the right edge. One control —
 * a checkbox menu item that does not close the menu — drawn with the kit's
 * switch. Switching on asks the browser; a refusal keeps it off and says why.
 */
export function OnScreenSwitchItem() {
  const enabled = useOnScreenStore((s) => s.enabled);
  const setEnabled = useOnScreenStore((s) => s.setEnabled);
  const hydrate = useOnScreenStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const toggle = async () => {
    const next = !enabled;
    const result = await setEnabled(next);
    if (next && result !== "granted") {
      toast.error(
        result === "unsupported"
          ? "This browser has no notifications"
          : "Notifications are blocked for this site — allow them in the browser's site settings",
      );
    }
  };

  return (
    <DropdownMenuItem
      role="menuitemcheckbox"
      aria-checked={enabled}
      onSelect={(e) => {
        // The menu stays open: a switch is flipped, not a page opened.
        e.preventDefault();
        void toggle();
      }}
      className="justify-between"
    >
      <span className="flex items-center gap-3 whitespace-nowrap">
        <Bell />
        {ON_SCREEN_LABEL}
      </span>
      {/* The item is the control; the switch only shows its state. */}
      <WzSwitch aria-hidden tabIndex={-1} checked={enabled} readOnly className="pointer-events-none" />
    </DropdownMenuItem>
  );
}
