"use client";

import { useState } from "react";
import { History, Paperclip, SquarePen } from "lucide-react";
import type { Contact } from "@bitcrm/types";
import { WzRailButton } from "@/components/workiz/rail";
import { useContactNotes } from "../notes-hooks";
import { ClientFilesPanel } from "./client-files-panel";
import { ClientHistoryPanel } from "./client-history-panel";
import { ClientNotesPanel } from "./client-notes-panel";

type Panel = "notes" | "history" | "files";

/**
 * Workiz's right rail on the client page (`clientRightPane`,
 * pg_contact_wz_269669_01/_11): a 71px white column, 1px rule on its left,
 * Notes (a red count) / History / Files as 54px captioned tiles 70px apart,
 * 15px from the top. Opening one lays the rail and a 350px panel OVER the
 * right of the page (the grid underneath does not move); the open one's tile
 * turns #f3f6f7; its button again, or the ×, closes it.
 *
 * Renders inside the page's `relative` frame.
 */
export function ClientRail({ contact, canEdit }: { contact: Contact; canEdit: boolean }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  // The badge reads the first page: the CRM's total when it counts, else what
  // came back — plus the client form's old notes field, shown as a card too.
  const notes = useContactNotes(contact.id);
  const loaded = notes.data?.pages.flatMap((p) => p.data).length ?? 0;
  const count = (notes.data?.pages[0]?.pagination?.notesCount ?? loaded) + (contact.notes ? 1 : 0);
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));
  const close = (o: boolean) => !o && setPanel(null);

  const buttons = (
    <div aria-label="Client rail" role="complementary" className="flex flex-col items-center gap-4 pt-[15px] max-md:flex-row max-md:justify-center max-md:pt-2 max-md:pb-2">
      <WzRailButton icon={SquarePen} label="Notes" caption badge={count > 0 ? (count > 99 ? "99+" : count) : undefined} active={panel === "notes"} onClick={() => toggle("notes")} />
      <WzRailButton icon={History} label="History" caption active={panel === "history"} onClick={() => toggle("history")} />
      <WzRailButton icon={Paperclip} label="Files" caption active={panel === "files"} onClick={() => toggle("files")} />
    </div>
  );

  return (
    <>
      {/* The column itself; while a panel is open the overlay carries the buttons. */}
      <div className="w-full shrink-0 border-t border-border bg-white md:w-[71px] md:border-t-0 md:border-l">{panel ? null : buttons}</div>
      {panel ? (
        <div data-slot="client-rail-overlay" className="absolute inset-y-0 right-0 z-30 flex max-w-full border-l border-border bg-white max-md:fixed">
          <div className="w-[70px] shrink-0 border-r border-border">{buttons}</div>
          <ClientNotesPanel contactId={contact.id} description={contact.notes} canEdit={canEdit} open={panel === "notes"} onOpenChange={close} />
          <ClientHistoryPanel contactId={contact.id} open={panel === "history"} onOpenChange={close} />
          <ClientFilesPanel contactId={contact.id} canEdit={canEdit} open={panel === "files"} onOpenChange={close} />
        </div>
      ) : null}
    </>
  );
}
