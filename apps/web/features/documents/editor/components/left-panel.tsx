"use client";

import { Blocks, Braces, Eye, LayoutTemplate, Palette, Settings2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEditorUi, type LeftTab } from "../ui-store";
import { DesignPanel } from "./design-panel";
import { LayoutPanel, ToolsPanel } from "./palette";
import { SettingsPanel, VisibilityPanel } from "./settings-panels";
import { ValuesPanel } from "./values-panel";

const TABS: { id: LeftTab; label: string; icon: typeof Blocks; panel: () => React.ReactNode }[] = [
  { id: "design", label: "Design", icon: Palette, panel: () => <DesignPanel /> },
  { id: "layout", label: "Layout", icon: LayoutTemplate, panel: () => <LayoutPanel /> },
  { id: "tools", label: "Tools", icon: Blocks, panel: () => <ToolsPanel /> },
  { id: "values", label: "Values", icon: Braces, panel: () => <ValuesPanel /> },
  { id: "visibility", label: "Client visibility", icon: Eye, panel: () => <VisibilityPanel /> },
  { id: "settings", label: "Settings", icon: Settings2, panel: () => <SettingsPanel /> },
];

/** Left sidebar: an icon rail of tabs and the active panel. */
export function LeftPanel() {
  const tab = useEditorUi((s) => s.leftTab);
  const setTab = useEditorUi((s) => s.setLeftTab);
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as LeftTab)} orientation="vertical" className="flex h-full min-h-0 flex-row gap-0">
      <TabsList variant="line" className="h-full w-16 flex-none justify-start gap-1 rounded-none border-r bg-muted/30 px-1 py-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <TabsTrigger
              key={t.id}
              value={t.id}
              aria-label={t.label}
              className="h-auto w-full flex-none flex-col gap-1 px-0.5 py-1.5 text-[10px] leading-tight whitespace-normal"
            >
              <Icon className="size-4" />
              <span className="text-center">{t.label === "Client visibility" ? "Clients" : t.label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
      <TabsContent value={active.id} className="min-h-0 min-w-0 flex-1 overflow-y-auto" tabIndex={-1}>
        <div className="border-b px-3 py-2.5">
          <h3 className="text-sm font-semibold">{active.label}</h3>
        </div>
        {active.panel()}
      </TabsContent>
    </Tabs>
  );
}
