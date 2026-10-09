/**
 * The call log's filters as one DynamoDB FilterExpression — shared by the
 * list, its count, the stat cards and the CSV export, so all four describe
 * the same calls.
 *
 * Every filter of Workiz's "+ Add filter" is a list of checkboxes, so each
 * takes several values: on the wire a comma list, `status=missed,busy`. ONE
 * value keeps the exact expression it had before lists existed
 * (`#status = :status`) — old links, the count cache and the tests that pin
 * those strings all keep their meaning.
 *
 * Status also takes Workiz's four categories (callspage_wz_05_filter_status:
 * Answered, Missed, Active, Voicemail), spelled out over the row with the
 * Call Tracking report's answer rule (`answerClassOf`, tracking/call-tracking.ts)
 * so "Missed" selects exactly what the MISSED CALLS card counts:
 *
 *  - imported Workiz calls (`externalId` workiz:call:…) are judged by Workiz's
 *    own dial status: completed = answered; empty or no-answer = missed,
 *    except an empty one the flow's voicemail box took (`voicemail` 2);
 *  - our own calls: answered = somebody picked up (`answeredAt`) or the call
 *    completed; missed = neither, and no longer live.
 *
 * Missed and Voicemail are inbound notions (Workiz's outgoing call that
 * nobody took is "No answer", not "Missed"); Answered is either way.
 * Comparisons on an attribute a row lacks are false in DynamoDB, so
 * `NOT x = :v` holds for a row without `x` — the rules lean on that.
 */

/** Workiz's Status categories, as the `status` filter accepts them. */
export const STATUS_CATEGORIES = ['answered', 'missed', 'active', 'voicemail'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

/** The statuses that mean the call is still happening. */
const LIVE = ['queued', 'initiated', 'ringing', 'in-progress'] as const;

/** DynamoDB's IN takes at most 100 operands; nobody ticks more than this. */
export const MAX_FILTER_VALUES = 50;

/** `"a, b,,a"` → `['a', 'b']`: trimmed, blanks and repeats dropped, capped. */
export function listOf(value: string | undefined): string[] {
  const out: string[] = [];
  for (const raw of (value ?? '').split(',')) {
    const v = raw.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, MAX_FILTER_VALUES);
}

/** The slice of `ListCallsFilter` this module turns into clauses. */
export interface CallFilterInput {
  status?: string;
  direction?: string;
  agentId?: string;
  tagId?: string;
  flowId?: string;
  sourceId?: string;
  minDuration?: number;
  maxDuration?: number;
  masked?: boolean;
  hasJob?: boolean;
}

type Names = Record<string, string>;
type Values = Record<string, unknown>;

/** `#x IN (:p0, :p1)` over a list, registering the values. */
function inList(attr: string, prefix: string, list: string[], values: Values): string {
  const keys = list.map((v, i) => {
    values[`:${prefix}${i}`] = v;
    return `:${prefix}${i}`;
  });
  return `${attr} IN (${keys.join(', ')})`;
}

function liveIn(names: Names, values: Values): string {
  names['#status'] = 'status';
  LIVE.forEach((s, i) => (values[`:live${i}`] = s));
  return `#status IN (${LIVE.map((_, i) => `:live${i}`).join(', ')})`;
}

/** The pieces the category rules share, registered once. */
function categoryTerms(names: Names, values: Values) {
  Object.assign(names, {
    '#status': 'status',
    '#direction': 'direction',
    '#answeredAt': 'answeredAt',
    '#externalId': 'externalId',
    '#dialCallStatus': 'dialCallStatus',
    '#voicemail': 'voicemail',
  });
  Object.assign(values, {
    ':completed': 'completed',
    ':catInbound': 'inbound',
    ':wzCall': 'workiz:call:',
  });
  return {
    imported: 'begins_with(#externalId, :wzCall)',
    inbound: '#direction = :catInbound',
    pickedUp: '(attribute_exists(#answeredAt) OR #status = :completed)',
  };
}

function categoryExpression(category: StatusCategory, names: Names, values: Values): string {
  if (category === 'active') return liveIn(names, values);

  const t = categoryTerms(names, values);
  switch (category) {
    case 'answered': {
      values[':dialCompleted'] = 'completed';
      return (
        `((${t.imported} AND ${t.inbound} AND #dialCallStatus = :dialCompleted) OR ` +
        `(NOT (${t.imported} AND ${t.inbound}) AND ${t.pickedUp}))`
      );
    }
    case 'missed': {
      values[':dialNoAnswer'] = 'no-answer';
      values[':empty'] = '';
      values[':vmBox'] = 2;
      const importedMissed =
        `(#dialCallStatus = :dialNoAnswer OR ((attribute_not_exists(#dialCallStatus) OR #dialCallStatus = :empty) AND NOT #voicemail = :vmBox))`;
      // A blocked caller's row was turned away on purpose — not a miss.
      values[':blocked'] = 'blocked';
      const oursMissed = `NOT ${t.pickedUp} AND NOT ${liveIn(names, values)} AND NOT #status = :blocked`;
      return `(${t.inbound} AND ((${t.imported} AND ${importedMissed}) OR (NOT ${t.imported} AND ${oursMissed})))`;
    }
    case 'voicemail': {
      names['#recordingSid'] = 'recordingSid';
      values[':zero'] = 0;
      // Ours: nobody picked up, yet there is a recording — the flow's
      // voicemail step is the only thing that records an unanswered call.
      return (
        `(${t.inbound} AND ((${t.imported} AND #voicemail > :zero) OR ` +
        `(NOT ${t.imported} AND NOT ${t.pickedUp} AND attribute_exists(#recordingSid))))`
      );
    }
  }
}

function statusClause(status: string | undefined, names: Names, values: Values): string | undefined {
  const all = listOf(status);
  if (!all.length) return undefined;
  const categories = all.filter((v): v is StatusCategory => (STATUS_CATEGORIES as readonly string[]).includes(v));
  const raw = all.filter((v) => !categories.includes(v as StatusCategory));

  names['#status'] = 'status';
  if (!categories.length && raw.length === 1) {
    values[':status'] = raw[0];
    return '#status = :status';
  }
  const legs = categories.map((c) => categoryExpression(c, names, values));
  if (raw.length) legs.push(inList('#status', 'st', raw, values));
  return legs.length === 1 ? legs[0] : `(${legs.join(' OR ')})`;
}

/**
 * The clauses for the filters above, to be ANDed with the rest. Names and
 * values are registered on the maps handed in.
 */
export function callFilterClauses(filter: CallFilterInput, names: Names, values: Values): string[] {
  const clauses: string[] = [];

  const status = statusClause(filter.status, names, values);
  if (status) clauses.push(status);

  const directions = listOf(filter.direction);
  if (directions.length === 1) {
    names['#direction'] = 'direction';
    values[':direction'] = directions[0];
    clauses.push('#direction = :direction');
  } else if (directions.length > 1) {
    names['#direction'] = 'direction';
    clauses.push(inList('#direction', 'dir', directions, values));
  }

  const agents = listOf(filter.agentId);
  if (agents.length === 1) {
    values[':agentId'] = agents[0];
    clauses.push('agentId = :agentId');
  } else if (agents.length > 1) {
    clauses.push(inList('agentId', 'ag', agents, values));
  }

  const tags = listOf(filter.tagId);
  if (tags.length) {
    // Tags are a list attribute, so membership is `contains` — and this is a
    // FilterExpression inside the date-ordered walk: DynamoDB reads every row
    // and drops the untagged ones after charging for them, which is why the
    // walk is bounded (see MAX_QUERY_PAGES). Several tags = any of them.
    names['#tagIds'] = 'tagIds';
    if (tags.length === 1) {
      values[':tagId'] = tags[0];
      clauses.push('contains(#tagIds, :tagId)');
    } else {
      const ors = tags.map((tag, i) => {
        values[`:tag${i}`] = tag;
        return `contains(#tagIds, :tag${i})`;
      });
      clauses.push(`(${ors.join(' OR ')})`);
    }
  }

  const flows = listOf(filter.flowId);
  if (flows.length) {
    names['#flowId'] = 'flowId';
    clauses.push(inList('#flowId', 'flow', flows, values));
  }

  const sources = listOf(filter.sourceId);
  if (sources.length) {
    names['#sourceId'] = 'sourceId';
    clauses.push(inList('#sourceId', 'src', sources, values));
  }

  if (typeof filter.minDuration === 'number') {
    names['#durationSeconds'] = 'durationSeconds';
    values[':minDuration'] = filter.minDuration;
    clauses.push('#durationSeconds >= :minDuration');
  }
  if (typeof filter.maxDuration === 'number') {
    // A call nobody answered has no talk time — Workiz prints it "0 Sec", and
    // "Under 30 sec" lists it.
    names['#durationSeconds'] = 'durationSeconds';
    values[':maxDuration'] = filter.maxDuration;
    clauses.push('(attribute_not_exists(#durationSeconds) OR #durationSeconds <= :maxDuration)');
  }

  if (typeof filter.masked === 'boolean') {
    // Ours: the masked bridge (`origin: bridge`). Imported: Workiz's own flag.
    names['#origin'] = 'origin';
    names['#isMasking'] = 'isMasking';
    values[':bridge'] = 'bridge';
    values[':masked'] = true;
    const masked = '(#origin = :bridge OR #isMasking = :masked)';
    clauses.push(filter.masked ? masked : `NOT ${masked}`);
  }

  if (typeof filter.hasJob === 'boolean') {
    // Workiz's Job Status panel offers "All with job"; a job's status itself
    // lives with the job, not on the call, so only "has one" is answerable here.
    names['#dealId'] = 'dealId';
    names['#workizJobId'] = 'workizJobId';
    clauses.push(
      filter.hasJob
        ? '(attribute_exists(#dealId) OR attribute_exists(#workizJobId))'
        : '(attribute_not_exists(#dealId) AND attribute_not_exists(#workizJobId))',
    );
  }

  return clauses;
}
