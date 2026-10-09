"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { WzSettingsBlock, WzSettingsTile } from "@/components/workiz/settings-page";
import { usePermissions } from "@/features/auth/use-permissions";
import { visibleSettingsGroups } from "./sections";

/**
 * The settings home, Workiz's (uikit_wz_settings_home): a heading per block
 * (General Settings, Users & Roles, Job Settings, Calls & Text…) over that
 * block's tiles, three to a row — each tile just the section's name and a
 * line glyph, its description left to the tooltip. It is the way to every
 * settings page: there is no rail, as in Workiz.
 *
 * Which sections show depends on the permissions, so until they are in the
 * page is one skeleton: drawn early, it stood at its one unguarded tile and
 * then grew to twenty under the reader.
 */
export function SettingsIndex() {
  const { can, isLoading } = usePermissions();

  if (isLoading) {
    return (
      <div className="px-5 pt-[34px]">
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  const groups = visibleSettingsGroups((r) => can(r));

  return (
    <div className="flex flex-col gap-[60px] px-5 pt-[34px] pb-[60px]">
      {groups.map((group) => (
        <WzSettingsBlock key={group.label} title={group.label}>
          {group.sections.map((section) => {
            const Icon = section.icon;
            return (
              <WzSettingsTile
                key={section.href}
                href={section.href}
                title={section.label}
                hint={section.description}
                icon={<Icon />}
              />
            );
          })}
        </WzSettingsBlock>
      ))}
    </div>
  );
}
