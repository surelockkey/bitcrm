/**
 * The Activity report's keys, on the timeline rows of the deals table.
 *
 *   DEAL#<dealId> / TIMELINE#<timestamp>#<id>     a job's event (native, or imported from Workiz)
 *   <owner>       / ACT#<timestamp>#<id>          an imported event with no job here — owner
 *                                                 CLIENT#<id>, USER#<id>, WUSER#<name>, WJOB#<workiz id>,
 *                                                 ACCOUNT#workiz#<YYYY-MM>
 *
 * Both kinds carry, sparsely (only rows that are Activity events):
 *
 *   GSI8 ActivityDayIndex  GSI8PK = ACTDAY#<YYYY-MM-DD, account day>   GSI8SK = <timestamp>#<id>
 *   GSI9 ActorIndex        GSI9PK = ACTOR#<actorId>                    GSI9SK = <timestamp>#<id>
 *
 * A day partition holds 2–7k events (the busiest Workiz day), so no key is
 * hot and a period is a walk over its days. `activitySearch` (lower-cased
 * action text + job code) is what the search filters on; `activitySource`
 * (web | mobile | system) is where a native event was done.
 *
 *   ACTCOUNT#<YYYY-MM-DD> / COUNT    { count } — events that day, for "of N"
 *
 * GSI8/GSI9 are 8 and 9 because 7 is the Jobs report's EndIndex (another
 * branch); the numbers only have to be unique.
 */
export const ACTIVITY_DAY_INDEX = 'ActivityDayIndex';
export const ACTIVITY_ACTOR_INDEX = 'ActorIndex';

export const activityDayPk = (day: string) => `ACTDAY#${day}`;
export const activityActorPk = (actorId: string) => `ACTOR#${actorId}`;
export const activitySk = (timestamp: string, id: string) => `${timestamp}#${id}`;
export const activityCountKey = (day: string) => ({ PK: `ACTCOUNT#${day}`, SK: 'COUNT' });

/** Actors a person can never pick in the filter — no point indexing them. */
export const UNFILTERABLE_ACTORS = new Set(['workiz:unresolved', 'system', '']);
