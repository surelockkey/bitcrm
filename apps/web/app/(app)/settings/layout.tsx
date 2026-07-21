import { SettingsSidebar } from "./settings-sidebar";

/** Settings shell: a header + a left rail of sections shared by every sub-route. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
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
