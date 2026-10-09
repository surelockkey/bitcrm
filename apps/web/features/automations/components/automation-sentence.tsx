import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { conditionLineParts, sentenceParts, type SentencePart } from "../sentence-slots";

/**
 * How each place draws the parts (Workiz's `highlightedString` + its hosts):
 *
 *   card       a rule card's sentence — 14px/22px, glue #9ea6aa, slots 500 ink underlined
 *              (pg_automations_wz_10_mine);
 *   builder    a line on the builder's slate canvas — 32px/48px, glue #9ea6aa, slots white
 *              underlined (pg_automations_wz_31);
 *   condition  an "Only if" line there — 16px/30px white, slots 600 #50d58c underlined.
 */
const TONE = {
  card: { plain: "text-wz-outline", slot: "font-medium text-foreground underline" },
  builder: { plain: "text-wz-outline", slot: "text-white underline decoration-1 underline-offset-[6px]" },
  condition: { plain: "text-white", slot: "font-semibold text-wz-switch-on underline underline-offset-2" },
} as const;

export type SentenceTone = keyof typeof TONE;

export function SentenceParts({ parts, tone }: { parts: SentencePart[]; tone: SentenceTone }) {
  return (
    <>
      {parts.map((part, i) =>
        part.slot ? (
          <span key={i} data-sentence-slot className={TONE[tone].slot}>
            {part.text}
          </span>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * A rule's sentence with Workiz's underlined slots. The text node structure
 * is the sentence itself, so `getByText(sentence)` still finds it whole.
 */
export function AutomationSentence({
  text,
  tone = "card",
  className,
}: {
  text: string;
  tone?: SentenceTone;
  className?: string;
}) {
  return (
    <p className={cn(TONE[tone].plain, className)}>
      <SentenceParts parts={sentenceParts(text)} tone={tone} />
    </p>
  );
}

/** A condition step as Workiz writes it: "Only if [source] = [Car Key Duplicates Form]". */
export function ConditionLine({ clause, className }: { clause: string; className?: string }) {
  return (
    <span className={cn(TONE.condition.plain, className)}>
      <SentenceParts parts={conditionLineParts(clause)} tone="condition" />
    </span>
  );
}
