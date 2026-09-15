import { describe, it, expect } from "vitest";
import {
  messagingSettingsSchema,
  settingsToForm,
  templateFormSchema,
  toSettingsBody,
  toTemplateBody,
} from "./schemas";

describe("templateFormSchema", () => {
  it("requires a title and a body, defaults the rest", () => {
    const bad = templateFormSchema.safeParse({ messageTemplateTitle: " ", messageTemplate: "x" });
    expect(bad.success).toBe(false);

    const ok = templateFormSchema.parse({ messageTemplateTitle: "On my way", messageTemplate: "Hi {{first_name}}" });
    expect(ok.channel).toBe("sms");
    expect(ok.isDefault).toBe(false);
    expect(ok.active).toBe(true);
  });

  it("drops the subject for SMS templates and empties to undefined", () => {
    const sms = toTemplateBody(
      templateFormSchema.parse({ messageTemplateTitle: "t", messageTemplate: "b", messageSubjectTemplate: "S", category: "" }),
    );
    expect(sms.messageSubjectTemplate).toBeUndefined();
    expect(sms.category).toBeUndefined();

    const email = toTemplateBody(
      templateFormSchema.parse({ messageTemplateTitle: "t", messageTemplate: "b", messageSubjectTemplate: "S", channel: "email" }),
    );
    expect(email.messageSubjectTemplate).toBe("S");
  });
});

describe("messagingSettingsSchema", () => {
  const base = settingsToForm(undefined);

  it("normalises phones to E.164 and accepts blanks", () => {
    const out = messagingSettingsSchema.parse({ ...base, defaultSenderNumber: "(202) 555-0100", companyPhone: "" });
    expect(out.defaultSenderNumber).toBe("+12025550100");
    expect(out.companyPhone).toBe("");
  });

  it("rejects bad phones, urls, emails and zones", () => {
    expect(messagingSettingsSchema.safeParse({ ...base, defaultSenderNumber: "12" }).success).toBe(false);
    expect(messagingSettingsSchema.safeParse({ ...base, confirmLinkBaseUrl: "book.example.com" }).success).toBe(false);
    expect(messagingSettingsSchema.safeParse({ ...base, companyEmail: "office@" }).success).toBe(false);
    expect(messagingSettingsSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(messagingSettingsSchema.safeParse({ ...base, timezone: "America/New_York" }).success).toBe(true);
  });

  it("validates quiet hours only when enabled", () => {
    expect(messagingSettingsSchema.safeParse({ ...base, quietHoursEnabled: false, quietFrom: "nope" }).success).toBe(true);
    const on = messagingSettingsSchema.safeParse({ ...base, quietHoursEnabled: true, quietFrom: "25:00", quietTimezone: "" });
    expect(on.success).toBe(false);
    if (!on.success) {
      expect(on.error.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(["quietFrom", "quietTimezone"]));
    }
  });

  it("builds a PUT body that clears text with empty strings and omits blank phones", () => {
    const body = toSettingsBody(
      messagingSettingsSchema.parse({
        ...base,
        signature: "",
        smsPre: "SLK:",
        quietHoursEnabled: true,
        quietFrom: "20:00",
        quietTo: "08:00",
        quietTimezone: "America/New_York",
      }),
    );
    expect(body.signature).toBe("");
    expect(body.smsPre).toBe("SLK:");
    expect(body).not.toHaveProperty("defaultSenderNumber");
    expect(body.quietHours).toEqual({ from: "20:00", to: "08:00", timezone: "America/New_York" });
  });

  it("round-trips stored settings into the form", () => {
    const form = settingsToForm({
      defaultSenderNumber: "+12025550100",
      quietHours: { from: "21:00", to: "07:00", timezone: "America/Chicago" },
      signature: "— SLK",
    });
    expect(form.quietHoursEnabled).toBe(true);
    expect(form.quietFrom).toBe("21:00");
    expect(form.signature).toBe("— SLK");
  });
});
