/**
 * A rule's sentence as Workiz draws it: the words a person can change are
 * underlined ("When [a job] [has a status] of [Done], [send] [the client] …"),
 * the glue between them is plain (pg_automations_wz_10_mine: plain #9ea6aa,
 * slots 500 ink underlined; the builder's 32px lines, pg_automations_wz_31).
 *
 * It only *splits* the sentence `automationSentence` already wrote — it never
 * writes one — so the card, the builder and the firing log keep saying the
 * same thing, and joining the parts gives the sentence back character for
 * character. The split is by the sentence's own vocabulary: the glue words it
 * is built with, and the slot phrases that would otherwise run into each
 * other ("a job" + "has a status"). Whatever lies between is a value the
 * rule names (a status, a tag, a person, a delay), and so a slot.
 */
export interface SentencePart {
  text: string;
  /** Underlined: a part of the rule somebody picked. */
  slot: boolean;
}

/** The words the sentence is glued with — never underlined. */
const PLAIN = [
  "When it is",
  "When",
  "Only if",
  "of",
  "from",
  "and",
  "or",
  "to",
  "its",
  "Its",
  "is one of",
  "is not",
  "is",
  "it has a",
  "It has a",
  "it has no",
  "It has no",
  "Wait",
  "before this rule does anything",
  ",",
];

/** Slot phrases that sit side by side, so the gap between them is the only place to split. */
const SLOT = [
  // What fires the rule.
  "a job's",
  "a job",
  "a call",
  "a message",
  "a technician",
  // What happened to it.
  "is created",
  "has a status",
  "does not have a status",
  "status changes",
  "changes",
  "is assigned",
  "is rescheduled",
  "is missed",
  "is answered",
  "goes to voicemail",
  "ends",
  "is received",
  // What a reminder counts from.
  "the job's start",
  "the job's end",
  "the last status change",
  "the job being created",
  // What the rule does.
  "send",
  "Send",
  "a text and email",
  "a text message",
  "an email",
  "an in-app message",
  "post a webhook",
  "Post a webhook",
  "add the tag",
  "Add the tag",
  "set the status",
  "Set the status",
  "do nothing",
  "immediately",
];

const KIND = new Map<string, boolean>([
  ...PLAIN.map((p) => [p, false] as const),
  ...SLOT.map((s) => [s, true] as const),
]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every phrase, longest first so "is one of" wins over "is"; a phrase that
 * starts or ends with a letter must stand as words of its own ("a job" is not
 * the start of "a job's", "is" is not the end of "this").
 */
const PHRASE = new RegExp(
  [...KIND.keys()]
    .sort((a, b) => b.length - a.length)
    .map((p) => `${/^\w/.test(p) ? "(?<![\\w'’])" : ""}${escape(p)}${/\w$/.test(p) ? "(?![\\w'’])" : ""}`)
    .join("|"),
  "g",
);

function push(out: SentencePart[], text: string, slot: boolean) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && !last.slot && !slot) last.text += text;
  else out.push({ text, slot });
}

/** A run of free text: the value it holds is a slot, the spaces round it are not. */
function pushFree(out: SentencePart[], text: string) {
  const lead = text.match(/^\s*/)?.[0] ?? "";
  const trail = text.slice(lead.length).match(/\s*$/)?.[0] ?? "";
  push(out, lead, false);
  push(out, text.slice(lead.length, text.length - trail.length), true);
  push(out, trail, false);
}

export function sentenceParts(sentence: string): SentencePart[] {
  // An invitation ("Choose what to check") is one thing to press, not a
  // sentence with "to" in the middle of it.
  if (/^\s*Choose\b/.test(sentence)) {
    const out: SentencePart[] = [];
    pushFree(out, sentence);
    return out;
  }
  const out: SentencePart[] = [];
  let at = 0;
  for (const match of sentence.matchAll(PHRASE)) {
    const start = match.index ?? 0;
    pushFree(out, sentence.slice(at, start));
    push(out, match[0], KIND.get(match[0]) ?? true);
    at = start + match[0].length;
  }
  pushFree(out, sentence.slice(at));
  return out;
}

/** "is" / "is one of" read as Workiz's "=", "is not" as its "≠". */
const OPERATOR: Record<string, string> = { is: "=", "is one of": "=", "is not": "≠" };

/**
 * A condition step as Workiz writes it under the trigger: "Only if [source] =
 * [Car Key Duplicates Form]" (pg_automations_wz_31). Built from the same
 * clause the sentence says ("Its source is …"), with its "Its" dropped and
 * its verb drawn as the operator Workiz shows.
 */
export function conditionLineParts(clause: string): SentencePart[] {
  // "Its source is …" loses its "Its"; "It has a technician" keeps its words,
  // lower-cased, since "Only if" now starts the line.
  const body = clause.replace(/^\s*Its\s+/, "").replace(/^\s*It\b/, "it");
  const out: SentencePart[] = [{ text: "Only if ", slot: false }];
  for (const part of sentenceParts(body)) {
    const text = part.slot
      ? part.text
      : part.text.replace(/(^|\s)(is one of|is not|is)(?=\s|$)/g, (_, space: string, verb: string) => `${space}${OPERATOR[verb]}`);
    push(out, text, part.slot);
  }
  return out;
}
