"use client";

import type { Deal } from "@bitcrm/types";
import { SendDocumentDialog } from "@/features/portal/components/send-document-dialog";
import { useCreateProposal } from "../hooks";

/**
 * Workiz "Send all (Proposal)": the job's open estimates go to the client
 * together, as one proposal (good / better / best) in their portal. The send
 * panel is the same one a single document uses. `resend` sends the link of
 * the proposal already out again, without making another one.
 */
export function SendProposalDialog({
  deal,
  contactId,
  open,
  onOpenChange,
  resend = false,
}: {
  deal: Pick<Deal, "id" | "businessProfileId">;
  contactId: string;
  /** Every open estimate is already in a sent proposal: just send its link again. */
  resend?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const proposal = useCreateProposal(deal.id);
  return (
    <SendDocumentDialog
      open={open}
      onOpenChange={(o) => !o && onOpenChange(false)}
      channel="email"
      document={{
        kind: "proposal",
        id: deal.id,
        number: "",
        total: 0,
        contactId,
        dealId: deal.id,
        businessProfileId: deal.businessProfileId,
        alreadySent: resend,
      }}
      markSent={() => proposal.mutateAsync()}
    />
  );
}
