"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePermissions } from "@/features/auth/use-permissions";
import { ContactForm } from "@/features/clients/components/contact-form";
import { NewClientEstimateDialog } from "@/features/estimates/components/new-client-estimate-dialog";

/**
 * Workiz's "Create new" row (app_audit_wz_home, NewMainCta): 184×40 at
 * (8,76), white, a 24px yellow plus disc 8px in, the words 8px after it in
 * 13px/19px 600 — a bordered oval under the cursor. The row narrows to the
 * icon rail through animatable props only: the disc keeps its left edge
 * (same padding in both states), the words fade and clip instead of popping
 * out, so nothing jumps while the sidebar width animates.
 */
const TRIGGER =
  "flex h-10 w-full shrink-0 cursor-pointer items-center justify-start gap-2 overflow-hidden rounded-full border border-transparent bg-transparent px-[7px] text-[13px] leading-[19px] font-semibold tracking-[0.4px] text-foreground transition-[width,border-radius] duration-200 ease-linear outline-none hover:rounded-full hover:border-border hover:bg-card focus-visible:border-border data-[state=open]:border-border data-[state=open]:bg-card group-data-[collapsible=icon]:w-9";

/**
 * Its menu (shell_fix_wz_create_new_menu, AddNewItemMenu): 200px, white, 8px
 * corners, `0 4px 20px rgba(0,0,0,.25)`, 10px of air top and bottom, 9px
 * right of the row's edge and 8px under it; rows 32px with 14px/32px ink
 * words 25px in and no glyph; groups parted by a 1px rule 10px from the
 * rows either side.
 */
const PANEL =
  "w-[200px] min-w-0 rounded-[8px] px-0 py-[10px] shadow-[0_4px_20px_rgba(0,0,0,0.25)] [&_[data-slot=dropdown-menu-item]+[data-slot=dropdown-menu-item]]:border-t-0";
const ROW =
  "h-8 min-h-0 cursor-pointer rounded-none px-[25px] py-0 text-[14px] leading-8 text-foreground focus:bg-wz-secondary-hover focus:text-foreground";

/**
 * Workiz's list is Lead, Job, Client | Estimate, Invoice | Add to
 * sub-account, Event. Ours is what can be created from anywhere here — a job
 * (its own page), a client and a client's estimate (dialogs over the page) —
 * each only for a reader allowed to create it; the row itself goes when
 * that is nothing.
 */
export function CreateNewMenu() {
  const { can } = usePermissions();
  const router = useRouter();
  const [client, setClient] = useState(false);
  const [estimate, setEstimate] = useState(false);

  const canJob = can("deals", "create");
  const canClient = can("contacts", "create");
  const canEstimate = can("estimates", "create");
  if (!canJob && !canClient && !canEstimate) return null;

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={TRIGGER}>
            <span
              data-slot="create-new-dot"
              className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
            >
              <Plus className="size-4" />
            </span>
            <span className="whitespace-nowrap transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:opacity-0">
              Create new
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" alignOffset={9} sideOffset={8} className={PANEL}>
          {canJob ? (
            <DropdownMenuItem asChild className={ROW}>
              <Link href="/deals/new">Job</Link>
            </DropdownMenuItem>
          ) : null}
          {canClient ? (
            <DropdownMenuItem className={ROW} onSelect={() => setClient(true)}>
              Client
            </DropdownMenuItem>
          ) : null}
          {(canJob || canClient) && canEstimate ? (
            <DropdownMenuSeparator className="mx-0 my-[10px] bg-sidebar-border" />
          ) : null}
          {canEstimate ? (
            <DropdownMenuItem className={ROW} onSelect={() => setEstimate(true)}>
              Estimate
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The contacts page's "Add Client" dialog, hosted here so it opens over
          whatever page the reader is on; done, it lands on the new client. */}
      {canClient ? (
        <Dialog open={client} onOpenChange={setClient}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Client</DialogTitle>
            </DialogHeader>
            {client ? (
              <ContactForm
                onCancel={() => setClient(false)}
                onDone={(c) => {
                  setClient(false);
                  router.push(`/contacts/${c.id}`);
                }}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
      {canEstimate ? <NewClientEstimateDialog open={estimate} onOpenChange={setEstimate} /> : null}
    </>
  );
}
