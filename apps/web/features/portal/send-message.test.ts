import { describe, expect, it } from "vitest";
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings } from "@bitcrm/types";
import { renderSendMessage, sendMessageFor } from "./send-message";

const ctx = {
  kind: "invoice" as const,
  number: "1042",
  total: 348.5,
  firstName: "Jane",
  lastName: "Client",
  businessName: "Sure Lock Key",
  url: "https://portal.test/tok",
};

describe("renderSendMessage", () => {
  it("fills Workiz-style short codes", () => {
    expect(
      renderSendMessage(
        "Hi {{client.firstName}} ({{client.fullName}}), {{business.name}} invoice #{{document.number}} = {{document.total}}: {{portal_link}}",
        ctx,
      ),
    ).toBe("Hi Jane (Jane Client), Sure Lock Key invoice #1042 = $348.50: https://portal.test/tok");
  });

  it("blanks a code it cannot fill and tolerates spaces inside the braces", () => {
    expect(renderSendMessage("Hi {{ client.firstName }}, {{unknown.code}} ok", { ...ctx, firstName: undefined })).toBe(
      "Hi ,  ok",
    );
  });
});

describe("sendMessageFor", () => {
  it("renders the account's template for the document kind — subject for email, the same message for a text", () => {
    const settings: DocumentSettings = {
      ...DEFAULT_DOCUMENT_SETTINGS,
      invoiceEmailSubject: "Your service with {{business.name}}",
      invoiceMessage: "Greetings {{client.fullName}}. Click the link below to view your invoice.\n{{portal_link}}",
    };
    expect(sendMessageFor(settings, ctx)).toEqual({
      subject: "Your service with Sure Lock Key",
      body: "Greetings Jane Client. Click the link below to view your invoice.\nhttps://portal.test/tok",
    });
  });

  it("falls back to the built-in defaults when the settings are not loaded yet, per kind", () => {
    const estimate = sendMessageFor(undefined, { ...ctx, kind: "estimate" });
    expect(estimate.subject).toBe("Your estimate from Sure Lock Key");
    expect(estimate.body).toContain("https://portal.test/tok");
    expect(estimate.body).toContain("#1042");
    const proposal = sendMessageFor(undefined, { ...ctx, kind: "proposal" });
    expect(proposal.subject).toBe("View your proposal from Sure Lock Key");
  });
});
