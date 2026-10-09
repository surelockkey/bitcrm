import { CALL_FLOW_LIMITS, type CallFlow, type ResolvedCallGroupMember } from "@bitcrm/types";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { DEFAULT_TZ } from "@/lib/timezone";

/*
 * The words and the wiring behind Workiz Phone's settings tabs — Phone
 * numbers, Call flows, Call groups (pg_settings_phone_wz_numbers / _flows /
 * _groups) — kept out of the components so they can be tested.
 */

/**
 * "Sun Sep 27, 2020 11:11 pm" — Workiz's Created cell on the numbers list:
 * the weekday, a two-digit day and hour, lower-case am/pm, on the account's
 * clock. Empty when the server does not say (an API from before
 * `dateCreated`, or Twilio silent).
 */
export function formatNumberCreated(iso: string | null | undefined, tz: string = DEFAULT_TZ): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.month} ${parts.day}, ${parts.year} ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`;
}

const samePhone = (a: string, b: string) => (normalizePhone(a) ?? a) === (normalizePhone(b) ?? b);

/** The flow answering `number` — a number is answered by one flow at most. */
export function flowOfNumber(flows: readonly CallFlow[], number: string): CallFlow | undefined {
  return flows.find((f) => f.numbers.some((n) => samePhone(n, number)));
}

/** One flow's numbers after a move — what `PUT /call-flows/:id` is sent. */
export interface FlowNumbersWrite {
  id: string;
  numbers: string[];
}

/**
 * The writes that put `number` on the flow `toFlowId` (null: on none — the
 * numbers list's "Remove flow"). The server refuses a number two flows
 * answer, so the flow that has it lets go first, then the new one takes it.
 * Nothing when the number is already where it should be.
 */
export function numberFlowMoves(
  flows: readonly CallFlow[],
  number: string,
  toFlowId: string | null,
): FlowNumbersWrite[] {
  const current = flowOfNumber(flows, number);
  const target = toFlowId ? flows.find((f) => f.id === toFlowId) : undefined;
  if (toFlowId && !target) return [];
  if (current?.id === target?.id) return [];

  const writes: FlowNumbersWrite[] = [];
  if (current) writes.push({ id: current.id, numbers: current.numbers.filter((n) => !samePhone(n, number)) });
  if (target) writes.push({ id: target.id, numbers: [...target.numbers, number] });
  return writes;
}

/** What a duplicated flow is created with (`POST /call-flows`). */
export interface DuplicateFlowValues {
  name: string;
  entryNodeId: string;
  nodes: CallFlow["nodes"];
  businessProfileId?: string;
  numbers: string[];
  active: boolean;
}

/**
 * Workiz's copy icon on the flows list: the same steps and company under
 * "<name> (copy)", answering no number — a number has one flow — and paused,
 * so the copy never competes with its original (two live flows that collect
 * job codes are refused).
 */
export function duplicateFlowValues(flow: CallFlow, maxName: number = CALL_FLOW_LIMITS.nameMaxLength): DuplicateFlowValues {
  const suffix = " (copy)";
  const name = `${flow.name.slice(0, Math.max(0, maxName - suffix.length)).trimEnd()}${suffix}`;
  return {
    name,
    entryNodeId: flow.entryNodeId,
    nodes: flow.nodes,
    ...(flow.businessProfileId ? { businessProfileId: flow.businessProfileId } : {}),
    numbers: [],
    active: false,
  };
}

/** "(469) 848-3641,(803) 219-2657" — Workiz's Numbers cell on the flows list. */
export function flowNumbersText(numbers: readonly string[]): string {
  return numbers.map((n) => formatPhone(n) || n).join(",");
}

/** How one member is rung: "(Softphone)", "((203) 989-3585)", "(Softphone, (203) 989-3585)". */
function reachText(m: ResolvedCallGroupMember): string {
  const phone = m.phone ? formatPhone(m.phone) || m.phone : "Personal phone";
  if (m.channel === "softphone") return "Softphone";
  if (m.channel === "personal") return phone;
  return `Softphone, ${phone}`;
}

/**
 * Workiz's "Users and devices" cell — "Lily Support Manager (Softphone),
 * SURE CT LOCKSMITH ((203) 989-3585)": every member in ring order, with the
 * phone that rings them.
 */
export function groupMembersText(members: readonly ResolvedCallGroupMember[]): string {
  return [...members]
    .sort((a, b) => a.order - b.order)
    .map((m) => `${m.name ?? "Former teammate"} (${reachText(m)})`)
    .join(", ");
}
