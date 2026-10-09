import { SettingsFrame } from "./settings-frame";

/**
 * Settings shell. Workiz's settings pages (the home and the rebuilt catalogs)
 * draw their own frame; the rest keep the "Settings" heading and the rail.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsFrame>{children}</SettingsFrame>;
}
