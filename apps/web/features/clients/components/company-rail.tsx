"use client";

import { MessageSquareText, Pencil, Plus, SquarePen } from "lucide-react";
import type { Company } from "@bitcrm/types";
import { WzRailButton, WzRailPanel } from "@/components/workiz/rail";
import { PartyChat } from "@/features/messaging/components/party-chat";
import { EmptyNotesArt } from "./client-rail-art";

export type CompanyRailPanel = "notes" | "messages";

/** Workiz's blue words-buttons in the panels ("+ Add note"): 13px/19px 600 #3589e9. */
const BLUE = "flex h-[19px] w-fit items-center gap-1.5 text-[13px] leading-[19px] font-semibold text-brand outline-none hover:underline focus-visible:underline";

/**
 * The company page's right rail, drawn as the client page's
 * (`clientRightPane`, pg_contact_wz_269669_01/_11 — our `ClientRail`): a 71px
 * white column, a rule on its left, captioned 54px tiles 15px from the top.
 * Opening one lays the rail and a 350px panel OVER the right of the page;
 * its tile again, or the ×, closes it.
 *
 * - Notes: the company's notes (one text, a field of the company — Edit
 *   company info writes it), counted on the tile as Workiz counts notes.
 * - Messages (ours, for `messages.view`): the company's SMS thread, where
 *   Workiz's job page keeps its chat — the rail.
 *
 * The open panel is the page's, so "Create new → Message" and the message
 * button by the number can open it. Renders inside the page's `relative` frame.
 */
export function CompanyRail({
  company,
  canEdit,
  canMessages,
  panel,
  onPanelChange,
  onEditNotes,
}: {
  company: Company;
  canEdit: boolean;
  canMessages: boolean;
  panel: CompanyRailPanel | null;
  onPanelChange: (panel: CompanyRailPanel | null) => void;
  /** Opens Edit company info, where the notes are written. */
  onEditNotes: () => void;
}) {
  const notes = company.notes?.trim();
  const toggle = (p: CompanyRailPanel) => onPanelChange(panel === p ? null : p);
  const close = () => onPanelChange(null);

  const buttons = (
    <div aria-label="Company rail" role="complementary" className="flex flex-col items-center gap-4 pt-[15px] max-md:flex-row max-md:justify-center max-md:pt-2 max-md:pb-2">
      <WzRailButton icon={SquarePen} label="Notes" caption badge={notes ? 1 : undefined} active={panel === "notes"} onClick={() => toggle("notes")} />
      {canMessages ? (
        <WzRailButton icon={MessageSquareText} label="Messages" caption active={panel === "messages"} onClick={() => toggle("messages")} />
      ) : null}
    </div>
  );

  return (
    <>
      {/* The column itself; while a panel is open the overlay carries the buttons. */}
      <div className="w-full shrink-0 border-t border-border bg-white md:w-[71px] md:border-t-0 md:border-l">{panel ? null : buttons}</div>
      {panel ? (
        <div data-slot="company-rail-overlay" className="absolute inset-y-0 right-0 z-30 flex max-w-full border-l border-border bg-white max-md:fixed">
          <div className="w-[70px] shrink-0 border-r border-border">{buttons}</div>
          {panel === "notes" ? (
            <WzRailPanel variant="plain" aria-label="Notes" title="Notes" onClose={close} className="max-md:w-full">
              <div className="px-4 pt-[13px] pb-6 text-sm leading-[21px] tracking-[0.4px] text-foreground">
                {canEdit ? (
                  <button type="button" onClick={onEditNotes} className={BLUE}>
                    {notes ? <Pencil className="size-4" strokeWidth={1.75} /> : <Plus className="size-4" strokeWidth={1.75} />}
                    {notes ? "Edit note" : "Add note"}
                  </button>
                ) : null}
                {notes ? (
                  // Workiz's note card: 1px #dfe2e3, r5, 16px in, 14px/21px.
                  <div data-testid="note-card" className="mt-6 rounded-[5px] border border-border bg-white p-4">
                    <div className="flex items-start gap-2">
                      <span aria-hidden className="grid size-[31px] flex-none place-items-center rounded-full bg-muted-foreground text-xs font-medium text-white">
                        {company.title.trim().charAt(0).toUpperCase() || "C"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div>Company notes</div>
                        <div className="text-[11px] leading-4 text-wz-outline">From the company form</div>
                      </div>
                    </div>
                    <p className="mt-3 break-words whitespace-pre-wrap">{notes}</p>
                  </div>
                ) : (
                  <div className="mt-[180px] flex flex-col items-center text-center">
                    <EmptyNotesArt />
                    <p className="mt-6">No notes yet.</p>
                  </div>
                )}
              </div>
            </WzRailPanel>
          ) : (
            <WzRailPanel variant="plain" aria-label="Messages" title="Messages" onClose={close} className="max-md:w-full" bodyClassName="flex flex-col">
              {/* The primary number is the one to text: without it a company with no thread yet had no number to start one on. */}
              <PartyChat partyKind="company" partyId={company.id} address={company.phones[0]} autoFocus className="m-3 min-h-[24rem] flex-1" />
            </WzRailPanel>
          )}
        </div>
      ) : null}
    </>
  );
}
