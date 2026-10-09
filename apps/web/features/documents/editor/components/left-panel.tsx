"use client";

import { WzTabBar } from "@/components/workiz/tab-bar";
import { useEditorUi, type LeftTab } from "../ui-store";
import { DesignPanel } from "./design-panel";
import { LayoutPanel, ToolsPanel } from "./palette";
import { SettingsPanel, VisibilityPanel } from "./settings-panels";
import { ValuesPanel } from "./values-panel";

/** Workiz's Design | Tools | Layout first, then ours. */
const TABS: { id: LeftTab; label: string; panel: () => React.ReactNode }[] = [
  { id: "design", label: "Design", panel: () => <DesignPanel /> },
  { id: "tools", label: "Tools", panel: () => <ToolsPanel /> },
  { id: "layout", label: "Layout", panel: () => <LayoutPanel /> },
  { id: "values", label: "Values", panel: () => <ValuesPanel /> },
  { id: "visibility", label: "Clients", panel: () => <VisibilityPanel /> },
  { id: "settings", label: "Settings", panel: () => <SettingsPanel /> },
];

/**
 * The designer's side panel, as Workiz's (pg_settings_general_wz_doc_tab_tools):
 * Tabs-module tabs along its top (13px, slate at rest, ink 600 over a 2px
 * bar when open, a 1px #c4c4c4 rule), the open tab's panel under them.
 * "Clients" is what the client may see on the document.
 */
export function LeftPanel() {
  const tab = useEditorUi((s) => s.leftTab);
  const setTab = useEditorUi((s) => s.setLeftTab);
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WzTabBar
        aria-label="Panels"
        // Six tabs in Workiz's three's room: 10px either side instead of 20.
        className="flex-none [&>[role=tab]]:px-2.5"
        tabs={TABS.map((t) => ({ value: t.id, label: t.label }))}
        value={active.id}
        onValueChange={(v) => setTab(v as LeftTab)}
      />
      <div role="tabpanel" aria-label={active.id === "visibility" ? "Client visibility" : active.label} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {active.panel()}
      </div>
    </div>
  );
}
