import type { AdminAuditTargetType } from '@bitcrm/types';

// The admin trail (who did what to a person or a role), in the users table.
// Every entry is written three times, in one TransactWrite:
//   ADMINAUDIT#<YYYY-MM>                 / <ISO>#<id>   the whole trail, one partition per UTC month
//   ADMINAUDIT#<USER|ROLE>#<targetId>    / <ISO>#<id>   one subject's history
//   ADMINAUDIT#ACTOR#<actorId>           / <ISO>#<id>   one admin's history
// No GSI keys. Not `AUDIT#…`: that prefix is the technician documents' access log.
export const adminAuditMonthPk = (month: string) => `ADMINAUDIT#${month}`;
export const adminAuditTargetPk = (type: AdminAuditTargetType, id: string) =>
  `ADMINAUDIT#${type.toUpperCase()}#${id}`;
export const adminAuditActorPk = (actorId: string) => `ADMINAUDIT#ACTOR#${actorId}`;
