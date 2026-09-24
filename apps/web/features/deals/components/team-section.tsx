"use client";

import { useUserMap } from "../hooks";
import { AssignedTechRow } from "./assigned-tech-row";
import { TechRowActions } from "./tech-row-actions";
import { TechSuggestions } from "./tech-suggestions";

/**
 * A job's team, listed the way Workiz lists it: one technician per row, with
 * the things a dispatcher does with that person on the right, and the picker
 * underneath rather than in place of the list.
 *
 * Chips in a line had nowhere to put any of that, which is why the row exists.
 */
export function TeamSection({
  techIds,
  canEdit,
  onChange,
  address,
  jobTypeId,
  dealId,
  actions,
}: {
  techIds: string[];
  canEdit: boolean;
  onChange: (ids: string[]) => void;
  address: { lat?: number; lng?: number };
  jobTypeId: string;
  /** The job these people are on: it travels with anything sent from here. */
  dealId?: string;
  /** What this screen offers for one technician — call, message, look up. */
  actions?: (techId: string) => React.ReactNode;
}) {
  const { map } = useUserMap(techIds);

  return (
    <div className="space-y-2">
      {techIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">Unassigned</p>
      ) : (
        <div className="divide-y">
          {techIds.map((id) => (
            <AssignedTechRow
              key={id}
              techId={id}
              user={map.get(id)}
              onRemove={canEdit ? (t) => onChange(techIds.filter((x) => x !== t)) : undefined}
            >
              {actions ? actions(id) : <TechRowActions techId={id} user={map.get(id)} dealId={dealId} />}
            </AssignedTechRow>
          ))}
        </div>
      )}

      {canEdit ? (
        <TechSuggestions
          jobTypeId={jobTypeId}
          address={address}
          selected={techIds}
          onChange={onChange}
          hideSelected
        />
      ) : null}
    </div>
  );
}
