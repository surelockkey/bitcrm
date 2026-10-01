"use client";

import { useState } from "react";
import { History, Paperclip, StickyNote, type LucideIcon } from "lucide-react";
import type { Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { useContactNotes } from "../notes-hooks";
import { ClientFilesPanel } from "./client-files-panel";
import { ClientHistoryPanel } from "./client-history-panel";
import { ClientNotesPanel } from "./client-notes-panel";

type Panel = "notes" | "history" | "files";

/**
 * Workiz's right rail on the client card: Notes (with a count), History and
 * Files stacked top-right, each sliding its panel out on the right.
 */
export function ClientRail({ contact, canEdit }: { contact: Contact; canEdit: boolean }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  // The badge reads the first page: the CRM's total when it counts, else what
  // came back — plus the client form's old notes field, shown as a card too.
  const notes = useContactNotes(contact.id);
  const loaded = notes.data?.pages.flatMap((p) => p.data).length ?? 0;
  const count = (notes.data?.pages[0]?.notesCount ?? loaded) + (contact.notes ? 1 : 0);
  const close = (o: boolean) => !o && setPanel(null);

  return (
    <>
      <aside aria-label="Client rail" className="flex shrink-0 gap-2 border-t p-2 md:flex-col md:border-t-0 md:border-l">
        <RailButton icon={StickyNote} label="Notes" badge={count} onClick={() => setPanel("notes")} />
        <RailButton icon={History} label="History" onClick={() => setPanel("history")} />
        <RailButton icon={Paperclip} label="Files" onClick={() => setPanel("files")} />
      </aside>

      <ClientNotesPanel contactId={contact.id} description={contact.notes} canEdit={canEdit} open={panel === "notes"} onOpenChange={close} />
      <ClientHistoryPanel contactId={contact.id} open={panel === "history"} onOpenChange={close} />
      <ClientFilesPanel contactId={contact.id} canEdit={canEdit} open={panel === "files"} onOpenChange={close} />
    </>
  );
}

function RailButton({ icon: Icon, label, badge, onClick }: { icon: LucideIcon; label: string; badge?: number; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="relative flex-col gap-0.5 md:h-14 md:w-14" onClick={onClick} aria-label={label}>
      <Icon className="size-4" />
      <span className="text-[10px]">{label}</span>
      {badge ? (
        <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-destructive text-[9px] font-semibold tabular-nums text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Button>
  );
}
