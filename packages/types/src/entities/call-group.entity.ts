/**
 * How a group rings its members.
 *
 * `ring_all` is today's inbound behaviour narrowed to a list of people;
 * `in_order` rings them one at a time and needs per-leg timers, so it is
 * stored and edited now and honoured when routing lands.
 */
export type CallGroupType = 'ring_all' | 'in_order';

/**
 * Which of a member's destinations to ring. The same vocabulary the live-call
 * "add someone" action already uses, so one word means one thing everywhere.
 */
export type CallGroupChannel = 'softphone' | 'personal' | 'both';

/** One person in a group, and how to reach them. */
export interface CallGroupMember {
  /**
   * The system user. Deliberately the only identity stored — a phone number
   * copied in here would go stale the day they change it, and resolving at
   * ring time means a deactivated user stops ringing with no cleanup.
   */
  userId: string;
  channel: CallGroupChannel;
  /** Ring position for `in_order`; keeps the list stable for `ring_all` too. */
  order: number;
  /** Pause one person — holiday, training — without losing their place. */
  enabled: boolean;
}

/** A member with the bits the UI needs, resolved at read time (never stored). */
export interface ResolvedCallGroupMember extends CallGroupMember {
  /** Display name; absent when the user is gone from the directory. */
  name?: string;
  roleId?: string;
  /** Their own number, when they've set one on their profile. */
  phone?: string;
  /** Whether their softphone is registered right now. */
  softphoneOnline: boolean;
  /** They're no longer in the directory (deactivated or deleted). */
  missing: boolean;
}

/**
 * A device in a group (Workiz's "Users and devices"): a desk phone or shop
 * line from the Devices catalog. Its own list beside `members`, so every
 * reader of `members[].userId` is untouched — the number is read from the
 * catalog at ring time, never copied here.
 */
export interface CallGroupDeviceMember {
  deviceId: string;
  /** Ring position; keeps the list stable. */
  order: number;
  /** Pause one device without losing its place. */
  enabled: boolean;
}

/** A device member with the bits the UI needs, resolved at read time (never stored). */
export interface ResolvedCallGroupDeviceMember extends CallGroupDeviceMember {
  name?: string;
  /** The device's number (E.164) or SIP address, as it rings. */
  number?: string;
  /** The device is gone from the catalog. */
  missing: boolean;
}

/** A named list of the people an inbound call should reach. */
export interface CallGroup {
  id: string;
  name: string;
  description?: string;
  type: CallGroupType;
  members: CallGroupMember[];
  /** Devices rung beside the members (absent on groups saved before devices). */
  deviceMembers?: CallGroupDeviceMember[];
  /** A paused group keeps its membership but is skipped by routing. */
  active: boolean;
  /** How long each member's phone rings before giving up. */
  ringSeconds: number;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
}

/** What the API returns: the stored group plus the live view of its members. */
export interface CallGroupWithMembers extends Omit<CallGroup, 'members' | 'deviceMembers'> {
  members: ResolvedCallGroupMember[];
  deviceMembers?: ResolvedCallGroupDeviceMember[];
}

/** Bounds shared by the API's validation and the UI's affordances. */
export const CALL_GROUP_LIMITS = {
  nameMaxLength: 60,
  /** Every parallel leg is a billed call, and PSTN legs bill from first ring. */
  maxMembers: 20,
  minRingSeconds: 10,
  maxRingSeconds: 60,
  defaultRingSeconds: 25,
} as const;
