"use client";

import { Send } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Popover } from "radix-ui";
import { WzButton, WzSectionHeader } from "@/components/workiz";
import { useUserMap } from "../hooks";
import { withoutTech } from "../job-details-form";
import { AssignedTechRow } from "./assigned-tech-row";
import { SendToTechCard } from "./send-to-tech-card";
import { TechRowActions } from "./tech-row-actions";
import { WzTeamSelect } from "./workiz";

/**
 * Workiz's Team section on the job page (job_b_01_details_scroll1,
 * job_b_04_assign_tech_open): "Team" with the yellow "Send" pill at its
 * right, one row per technician (avatar, name, and on hover: details card,
 * call, message, remove), then "Assign A Tech" and the line saying how many
 * techs work in the area and can do the job.
 *
 * Assigning and removing apply at once, as they always have here; "Send"
 * opens our send-to-tech card (channels, Send / Resend, the sent and seen
 * stamps) under the pill — Workiz's pill opens a menu there too.
 */
export function JobTeamSection({
  deal,
  canEdit,
  jobTypeId,
  address,
  serviceAreaId,
  onChange,
}: {
  deal: Deal;
  canEdit: boolean;
  /** The draft's job type and address: who can do the job follows them. */
  jobTypeId: string;
  address: { lat?: number; lng?: number };
  serviceAreaId?: string;
  onChange: (techIds: string[]) => void;
}) {
  const techIds = deal.assignedTechIds;
  const { map } = useUserMap(techIds);

  return (
    <section aria-label="Team">
      <WzSectionHeader
        action={
          <Popover.Root>
            <Popover.Trigger asChild>
              <WzButton size="regular" icon={<Send strokeWidth={1.5} />}>
                Send
              </WzButton>
            </Popover.Trigger>
            <Popover.Portal>
              {/* A Workiz pop-menu panel: white, 2px corners, its two-part shadow. */}
              <Popover.Content
                align="end"
                sideOffset={6}
                aria-label="Send to tech"
                className="z-50 w-[320px] rounded-[2px] bg-white p-3 text-wz-strong shadow-[0_3px_6px_2px_rgba(0,0,0,0.18),0_4px_15px_2px_rgba(0,0,0,0.15)] outline-none"
              >
                <SendToTechCard deal={deal} canEdit={canEdit} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        }
      >
        Team
      </WzSectionHeader>

      {techIds.map((id) => (
        <AssignedTechRow
          key={id}
          techId={id}
          user={map.get(id)}
          onRemove={canEdit ? (t) => onChange(withoutTech(techIds, t)) : undefined}
        >
          <TechRowActions techId={id} user={map.get(id)} dealId={deal.id} />
        </AssignedTechRow>
      ))}

      {canEdit ? (
        <WzTeamSelect
          variant="add"
          shape="square"
          jobTypeId={jobTypeId}
          address={address}
          serviceAreaId={serviceAreaId}
          value={techIds}
          onChange={onChange}
          // details-module__row: the count line sits 10px under the select
          // (the New Job card puts it 13px under).
          className="mr-px [&_[data-testid=wz-team-notice]]:mt-2"
        />
      ) : techIds.length === 0 ? (
        <p className="text-[14px] leading-4 text-wz-caption">No technician assigned</p>
      ) : null}
    </section>
  );
}
