/**
 * An external company that sends work our way (roadside dispatchers, referral
 * partners, lead providers — Agero, Allied Dispatch…). A settings catalog:
 * admins maintain the list, and a job can record which company referred it.
 */
export interface ExternalCompany {
  id: string;
  name: string;
  email?: string;
  address?: string;
  phone?: string;
  /** Disabled companies stay resolvable on historical deals but leave the pickers. */
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
