import { describe, expect, it } from "vitest";
import { JobSuperStatus, type AutomationSpec } from "@bitcrm/types";
import { conditionLineParts, sentenceParts, type SentencePart } from "./sentence-slots";
import { specSentence } from "./lib";

/** The parts as Workiz draws them: `[slot]` underlined, the rest plain. */
const drawn = (parts: SentencePart[]) => parts.map((p) => (p.slot ? `[${p.text}]` : p.text)).join("");

describe("sentenceParts", () => {
  it("underlines what a Workiz sentence lets you change and leaves its glue plain", () => {
    expect(
      drawn(
        sentenceParts(
          "When a job has a status of Canceled check, send the assigned tech a text message immediately",
        ),
      ),
    ).toBe(
      "When [a job] [has a status] of [Canceled check], [send] [the assigned tech] [a text message] [immediately]",
    );
  });

  it("splits a call trigger into its entity and its event", () => {
    expect(drawn(sentenceParts("When a call is missed, send the client a text message immediately"))).toBe(
      "When [a call] [is missed], [send] [the client] [a text message] [immediately]",
    );
  });

  it("keeps the conditions' field and value as slots between their plain words", () => {
    expect(
      drawn(
        sentenceParts(
          "When a job is created and its job tag is SCHEDULED, and it has a technician, send the client a text and email after 1 day",
        ),
      ),
    ).toBe(
      "When [a job] [is created] and its [job tag] is [SCHEDULED], and it has a [technician], [send] [the client] [a text and email] [after 1 day]",
    );
  });

  it("underlines each name of a list on its own, the way Workiz underlines each value", () => {
    expect(drawn(sentenceParts("its source is one of GMB, Yelp or Facebook"))).toBe(
      "its [source] is one of [GMB], [Yelp] or [Facebook]",
    );
  });

  it("reads a reminder's offset and anchor as two slots", () => {
    expect(drawn(sentenceParts("When it is 1 hour before the job's start"))).toBe(
      "When it is [1 hour before] [the job's start]",
    );
  });

  it("does not take a job's for a job", () => {
    expect(drawn(sentenceParts("When a job's status changes from Done"))).toBe(
      "When [a job's] [status changes] from [Done]",
    );
  });

  it("reads the capitalised lines of the builder the same way", () => {
    expect(drawn(sentenceParts("Send the client a text message"))).toBe("[Send] [the client] [a text message]");
    expect(drawn(sentenceParts("Its job type is Car Key Copy"))).toBe("Its [job type] is [Car Key Copy]");
    expect(drawn(sentenceParts("Post a webhook to https://hooks.example.com/a"))).toBe(
      "[Post a webhook] to [https://hooks.example.com/a]",
    );
    expect(drawn(sentenceParts("Wait 1 hour before this rule does anything"))).toBe(
      "Wait [1 hour] before this rule does anything",
    );
  });

  it("keeps an invitation whole", () => {
    expect(drawn(sentenceParts("Choose what to check"))).toBe("[Choose what to check]");
  });

  it("gives back the sentence character for character", () => {
    const sentences = [
      "When a technician is assigned to a job, send the assigned tech a text message immediately",
      "When a job does not have a status of Done or Canceled, post a webhook to https://x.io/a?b=c immediately",
      "  When   a job changes  ",
      "",
      "When a message is received, add the tag VIP, and set the status to Waiting on parts 2 days before",
    ];
    for (const s of sentences) expect(sentenceParts(s).map((p) => p.text).join("")).toBe(s);
  });

  it("never draws a space as part of a slot", () => {
    for (const part of sentenceParts("When a job is created, send the client a text message immediately")) {
      if (part.slot) expect(part.text).toBe(part.text.trim());
    }
  });

  it("splits the sentence a real rule is shown with", () => {
    const spec: AutomationSpec = {
      version: 1,
      trigger: { kind: "deal.status_changed", to: [JobSuperStatus.DONE] },
      conditions: [],
      actions: [{ type: "send_sms", to: "client", body: "Thanks!" }],
    };
    const sentence = specSentence(spec);
    expect(sentenceParts(sentence).map((p) => p.text).join("")).toBe(sentence);
    expect(drawn(sentenceParts(sentence))).toBe(
      "When [a job] [has a status] of [Done], [send] [the client] [a text message] [immediately]",
    );
  });
});

describe("conditionLineParts", () => {
  it("says a condition as Workiz's 'Only if field = value'", () => {
    expect(drawn(conditionLineParts("Its source is Car Key Duplicates Form"))).toBe(
      "Only if [source] = [Car Key Duplicates Form]",
    );
  });

  it("uses ≠ for a negated condition and = for one of a list", () => {
    expect(drawn(conditionLineParts("Its job tag is not SCHEDULED"))).toBe("Only if [job tag] ≠ [SCHEDULED]");
    expect(drawn(conditionLineParts("Its source is one of GMB or Yelp"))).toBe("Only if [source] = [GMB] or [Yelp]");
  });

  it("keeps the words of a condition that has no value", () => {
    expect(drawn(conditionLineParts("It has a technician"))).toBe("Only if it has a [technician]");
    expect(drawn(conditionLineParts("This check holds for every job"))).toBe("Only if [this check holds for every job]");
    expect(drawn(conditionLineParts("Choose what to check"))).toBe("Only if [Choose what to check]");
  });
});
