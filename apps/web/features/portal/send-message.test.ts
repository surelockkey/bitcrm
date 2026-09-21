import { describe, expect, it } from "vitest";
import { defaultSendText } from "./send-message";

const base = { number: "1042", total: 348.5, url: "https://portal.test/tok" };

describe("defaultSendText", () => {
  it("greets the client, names the company and ends with the link", () => {
    expect(defaultSendText({ ...base, kind: "invoice", firstName: "Jane", businessName: "Sure Lock Key" })).toBe(
      "Hi Jane, your invoice #1042 from Sure Lock Key is ready ($348.50). View and pay it here: https://portal.test/tok",
    );
  });

  it("copes with no name and no company, and words an estimate differently", () => {
    expect(defaultSendText({ ...base, kind: "estimate" })).toBe(
      "Your estimate #1042 is ready ($348.50). View it here: https://portal.test/tok",
    );
  });
});
