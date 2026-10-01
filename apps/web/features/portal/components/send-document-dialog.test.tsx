import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { DEFAULT_DOCUMENT_SETTINGS, DEFAULT_PAYMENT_SETTINGS } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { SendDocumentDialog, type SendableDocument } from "./send-document-dialog";

const URL_ = "https://portal.test/tok_abc";
const doc: SendableDocument = {
  kind: "invoice",
  id: "d1",
  number: "1042",
  total: 348.5,
  contactId: "c1",
  dealId: "d1",
  businessProfileId: "bp1",
  alreadySent: false,
};
const contact = { id: "c1", firstName: "Jane", lastName: "Client", phones: ["+18605550199"], emails: [], addresses: [] };

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

/** The message box, once the client's link and name have seeded it. */
async function ready(): Promise<HTMLTextAreaElement> {
  const box = (await screen.findByLabelText("Message")) as HTMLTextAreaElement;
  await waitFor(() => expect(box.value).toContain(URL_));
  return box;
}
let calls: string[];
let sms: Record<string, unknown> | undefined;
let allowed: { methods: string[] | null } | undefined;
let patched: Record<string, unknown> | undefined;

const PAYMENT_SETTINGS_OFF = { ...DEFAULT_PAYMENT_SETTINGS };
const PAYMENT_SETTINGS_ON = {
  ...DEFAULT_PAYMENT_SETTINGS,
  onlinePaymentsEnabled: true,
  cardEnabled: true,
  bankEnabled: true,
};

function handlers(
  over: {
    contact?: object;
    smsStatus?: number;
    markSentStatus?: number;
    settings?: object | null;
    allowedStatus?: number;
    documentSettings?: object;
  } = {},
) {
  server.use(
    http.get("*/billing/payment-settings", () =>
      HttpResponse.json({
        success: true,
        data: over.settings ?? { ...PAYMENT_SETTINGS_OFF, stripeConfigured: false },
      }),
    ),
    http.get("*/billing/document-settings", () =>
      HttpResponse.json({ success: true, data: over.documentSettings ?? DEFAULT_DOCUMENT_SETTINGS }),
    ),
    http.patch("*/billing/invoices/d1/allowed-methods", async ({ request }) => {
      allowed = (await request.json()) as { methods: string[] | null };
      calls.push("allowed-methods");
      return over.allowedStatus && over.allowedStatus >= 400
        ? HttpResponse.json({ success: false, message: "Couldn't save the payment options" }, { status: over.allowedStatus })
        : HttpResponse.json({ success: true, data: { id: "d1" } });
    }),
    http.patch("*/billing/invoices/d1", async ({ request }) => {
      patched = (await request.json()) as Record<string, unknown>;
      calls.push("patch");
      return HttpResponse.json({ success: true, data: { id: "d1", ...patched } });
    }),
    http.patch("*/billing/estimates/d1", async ({ request }) => {
      patched = (await request.json()) as Record<string, unknown>;
      calls.push("patch");
      return HttpResponse.json({ success: true, data: { id: "d1", ...patched } });
    }),
    http.get("*/crm/contacts/c1", () => HttpResponse.json({ success: true, data: over.contact ?? contact })),
    http.get("*/billing/business-profiles", () =>
      HttpResponse.json({ success: true, data: [{ id: "bp1", name: "Sure Lock Key", email: "office@slk.test", isDefault: true }] }),
    ),
    http.post("*/billing/portal-links/c1/url", () => {
      calls.push("link");
      return HttpResponse.json({ success: true, data: { contactId: "c1", createdBy: "u", createdAt: "t", url: URL_, token: "tok_abc" } });
    }),
    http.post("*/billing/invoices/d1/mark-sent", () => {
      calls.push("mark-sent");
      return over.markSentStatus && over.markSentStatus >= 400
        ? HttpResponse.json({ success: false, message: "Cannot mark sent" }, { status: over.markSentStatus })
        : HttpResponse.json({ success: true, data: { id: "d1", sentAt: "t" } });
    }),
    http.post("*/messaging/messages", async ({ request }) => {
      calls.push("sms");
      sms = (await request.json()) as Record<string, unknown>;
      return over.smsStatus && over.smsStatus >= 400
        ? HttpResponse.json(
            { success: false, message: "RECIPIENT_OPTED_OUT: +18605550199 has opted out of SMS" },
            { status: over.smsStatus },
          )
        : HttpResponse.json({ success: true, data: { id: "m1", status: "queued" } }, { status: 202 });
    }),
  );
}

function open(
  props: Partial<{ document: SendableDocument; markSent: () => Promise<unknown>; channel: "sms" | "email" }> = {},
) {
  const onOpenChange = vi.fn();
  const markSent = props.markSent ?? vi.fn(async () => {
    await fetch("http://localhost/api/billing/invoices/d1/mark-sent", { method: "POST" }).catch(() => undefined);
  });
  renderWithClient(
    <SendDocumentDialog
      document={props.document ?? doc}
      channel={props.channel}
      open
      onOpenChange={onOpenChange}
      markSent={markSent}
    />,
  );
  return { onOpenChange, markSent };
}

beforeEach(() => {
  calls = [];
  sms = undefined;
  allowed = undefined;
  patched = undefined;
  toast.success.mockClear();
  toast.error.mockClear();
  // A stable idempotency key.
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "11111111-1111-4111-8111-111111111111" });
});

describe("SendDocumentDialog (the Workiz Send panel)", () => {
  it("is one side panel with From, To, Cc, Subject, Phone and Message, and both Send buttons", async () => {
    handlers();
    open();
    await ready();
    expect(screen.getByRole("heading", { name: /send invoice #1042/i })).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveValue("office@slk.test");
    expect(screen.getByLabelText("To")).toBeInTheDocument();
    expect(screen.getByLabelText("Cc")).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^send email$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^send text$/i })).toBeInTheDocument();
  });

  it("prefills the message from the account's template, with the client's own portal link and the company name", async () => {
    handlers({
      documentSettings: {
        ...DEFAULT_DOCUMENT_SETTINGS,
        invoiceEmailSubject: "Your service with {{business.name}}",
        invoiceMessage: "Greetings {{client.fullName}}. Thank you for your business with {{business.name}}. {{portal_link}}",
      },
    });
    open();
    const box = await ready();
    expect(box.value).toBe(`Greetings Jane Client. Thank you for your business with Sure Lock Key. ${URL_}`);
    expect(screen.getByLabelText("Subject")).toHaveValue("Your service with Sure Lock Key");
    expect(screen.getByLabelText("Phone")).toHaveTextContent(/860\) 555-0199/);
    expect(screen.getByText(/marked as sent so the client can open it/i)).toBeInTheDocument();
  });

  it("marks the invoice sent BEFORE texting (the portal shows sent documents only), then texts once", async () => {
    handlers();
    const order: string[] = [];
    const { onOpenChange } = open({ markSent: vi.fn(async () => { order.push("mark-sent"); }) });
    await ready();
    server.events.on("request:start", ({ request }) => {
      if (request.url.endsWith("/messaging/messages")) order.push("sms");
    });
    await user().click(screen.getByRole("button", { name: /^send text$/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(order).toEqual(["mark-sent", "sms"]);
    expect(sms).toMatchObject({
      contactId: "c1",
      channel: "sms",
      dealId: "d1",
      clientMessageId: "11111111-1111-4111-8111-111111111111",
      body: expect.stringContaining(URL_),
    });
    expect(toast.success).toHaveBeenCalledWith("Text sent to Jane");
  });

  it("does not mark an already-sent invoice again", async () => {
    handlers();
    const { markSent } = open({ document: { ...doc, alreadySent: true } });
    await ready();
    expect(screen.queryByText(/will be marked as sent/i)).not.toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: /^send text$/i }));
    await waitFor(() => expect(sms).toBeDefined());
    expect(markSent).not.toHaveBeenCalled();
  });

  it("sends the edited message", async () => {
    handlers();
    open({ document: { ...doc, alreadySent: true } });
    const box = await ready();
    await user().type(box, " Thanks!");
    await user().click(screen.getByRole("button", { name: /^send text$/i }));
    await waitFor(() => expect(sms?.body).toMatch(/Thanks!$/));
  });

  it("refuses to send once the link has been deleted from the text", async () => {
    handlers();
    open();
    const box = await ready();
    await user().clear(box);
    await user().type(box, "Your invoice is ready");
    expect(screen.getByText(/must contain the portal link/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^send text$/i })).toBeDisabled();
  });

  it("explains a client with no phone and disables the text button, keeping email available", async () => {
    handlers({ contact: { ...contact, phones: [], emails: ["jane@client.test"] } });
    open();
    await ready();
    expect(screen.getByText(/no phone number on file/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^send text$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^send email$/i })).toBeEnabled();
  });

  it("still texts when the viewer may not see phone numbers (the server picks the client's number)", async () => {
    handlers({ contact: { ...contact, phones: [], phoneCount: 1, phonesMasked: true } });
    open({ document: { ...doc, alreadySent: true } });
    await ready();
    expect(screen.queryByText(/no phone number on file/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^send text$/i })).toBeEnabled();
  });

  it("keeps the panel open and says why when the text is refused (opted out)", async () => {
    handlers({ smsStatus: 422 });
    const { onOpenChange } = open();
    await ready();
    await user().click(screen.getByRole("button", { name: /^send text$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/opted out of SMS/i);
    expect(alert).toHaveTextContent(/marked as sent, so you can try again/i);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("sends nothing when the invoice cannot be marked sent", async () => {
    handlers();
    const { onOpenChange } = open({ markSent: vi.fn().mockRejectedValue(new Error("Invoice was edited elsewhere")) });
    await ready();
    await user().click(screen.getByRole("button", { name: /^send text$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/edited elsewhere/i);
    expect(sms).toBeUndefined();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("offers a retry when the portal link cannot be fetched", async () => {
    handlers();
    server.use(http.post("*/billing/portal-links/c1/url", () => HttpResponse.json({ success: false, message: "down" }, { status: 500 })));
    open();
    expect(await screen.findByText(/couldn't get the client's portal link/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^send text$/i })).toBeDisabled();
  });
});

describe("SendDocumentDialog — by email", () => {
  const withEmail = { ...contact, emails: ["jane@client.test", "jane.work@client.test"] };

  it("addresses the client's first email, offers the others, and lets Cc be added", async () => {
    handlers({ contact: withEmail });
    open({ channel: "email" });
    await ready();
    const to = screen.getByLabelText("To");
    expect(within(to.closest("fieldset")!).getByText("jane@client.test")).toBeInTheDocument();
    await user().type(screen.getByLabelText("Cc"), "boss@client.test{enter}");
    expect(within(screen.getByLabelText("Cc").closest("fieldset")!).getByText("boss@client.test")).toBeInTheDocument();
  });

  it("marks the invoice sent, then emails the subject, message, To and Cc", async () => {
    handlers({ contact: withEmail });
    const order: string[] = [];
    const { onOpenChange } = open({ channel: "email", markSent: vi.fn(async () => { order.push("mark-sent"); }) });
    await ready();
    server.events.on("request:start", ({ request }) => {
      if (request.url.endsWith("/messaging/messages")) order.push("email");
    });
    const subject = screen.getByLabelText("Subject");
    await user().clear(subject);
    await user().type(subject, "Your invoice");
    await user().type(screen.getByLabelText("Cc"), "boss@client.test{enter}");
    await user().click(screen.getByRole("button", { name: /^send email$/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(order).toEqual(["mark-sent", "email"]);
    expect(sms).toMatchObject({
      contactId: "c1",
      channel: "email",
      subject: "Your invoice",
      toAddress: "jane@client.test",
      cc: ["boss@client.test"],
      dealId: "d1",
      body: expect.stringContaining(URL_),
    });
    expect(toast.success).toHaveBeenCalledWith("Email sent to Jane");
  });

  it("needs a subject and a To address", async () => {
    handlers({ contact: withEmail });
    open({ channel: "email" });
    await ready();
    await user().clear(screen.getByLabelText("Subject"));
    expect(screen.getByRole("button", { name: /^send email$/i })).toBeDisabled();
  });

  it("explains a client with no email and disables the email button", async () => {
    handlers();
    open({ channel: "email" });
    await ready();
    expect(screen.getByText(/no email address on file/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^send email$/i })).toBeDisabled();
  });

  it("keeps the panel open and says why when the email is refused", async () => {
    handlers({ contact: withEmail });
    server.use(
      http.post("*/messaging/messages", () =>
        HttpResponse.json({ success: false, message: "Email sending is not configured" }, { status: 501 }),
      ),
    );
    const { onOpenChange } = open({ channel: "email", document: { ...doc, alreadySent: true } });
    await ready();
    await user().click(screen.getByRole("button", { name: /^send email$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not configured/i);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("SendDocumentDialog — let client pay with, request signature, advanced", () => {
  it("offers the account's online methods, both ticked, and saves them before the send", async () => {
    handlers({ settings: { ...PAYMENT_SETTINGS_ON, stripeConfigured: true } });
    const { onOpenChange } = open({ document: { ...doc, alreadySent: true } });
    await ready();
    expect(await screen.findByLabelText("Card")).toBeChecked();
    expect(screen.getByLabelText("Bank")).toBeChecked();

    await user().click(screen.getByLabelText("Bank"));
    await user().click(screen.getByRole("button", { name: /^send text$/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(allowed).toEqual({ methods: ["card"] });
    // The client's copy must carry the right options before the link goes out.
    expect(calls.indexOf("allowed-methods")).toBeLessThan(calls.indexOf("sms"));
  });

  it("leaves the invoice alone when nothing was changed", async () => {
    handlers({ settings: PAYMENT_SETTINGS_ON });
    open({ document: { ...doc, alreadySent: true, requestSignature: true } });
    await ready();
    await screen.findByLabelText("Card");
    await user().click(screen.getByRole("button", { name: /^send text$/i }));
    await waitFor(() => expect(sms).toBeDefined());
    expect(allowed).toBeUndefined();
    expect(patched).toBeUndefined();
  });

  it("Request signature starts from the account default and is saved on the invoice when changed", async () => {
    handlers({ documentSettings: { ...DEFAULT_DOCUMENT_SETTINGS, requestInvoiceSignature: true } });
    open({ document: { ...doc, alreadySent: true } });
    await ready();
    const box = await screen.findByLabelText(/request signature/i);
    expect(box).toBeChecked();
    await user().click(box);
    await user().click(screen.getByRole("button", { name: /^send text$/i }));
    await waitFor(() => expect(sms).toBeDefined());
    expect(patched).toEqual({ requestSignature: false });
    expect(calls.indexOf("patch")).toBeLessThan(calls.indexOf("sms"));
  });

  it("Advanced: which details the client sees is saved on the document", async () => {
    handlers();
    open({ document: { ...doc, kind: "estimate", alreadySent: true } });
    await ready();
    await user().click(screen.getByRole("button", { name: /advanced/i }));
    await user().click(screen.getByLabelText("Price"));
    await user().click(screen.getByRole("button", { name: /^send text$/i }));
    await waitFor(() => expect(sms).toBeDefined());
    expect(patched).toEqual({ display: { unitPrice: false } });
  });

  it("says nothing about paying when the account takes no online payments", async () => {
    handlers();
    open({ document: { ...doc, alreadySent: true } });
    await ready();
    expect(screen.queryByText(/let client pay with/i)).toBeNull();
  });

  it("never asks about payment or a signature on an estimate — the client must sign to approve anyway", async () => {
    handlers({ settings: PAYMENT_SETTINGS_ON });
    open({ document: { ...doc, kind: "estimate", alreadySent: true } });
    await ready();
    expect(screen.queryByText(/let client pay with/i)).toBeNull();
    expect(screen.queryByLabelText(/request signature/i)).toBeNull();
  });

  it("stops and explains when the payment options can't be saved", async () => {
    handlers({ settings: PAYMENT_SETTINGS_ON, allowedStatus: 500 });
    const { onOpenChange } = open({ document: { ...doc, alreadySent: true } });
    await ready();
    await user().click(await screen.findByLabelText("Bank"));
    await user().click(screen.getByRole("button", { name: /^send text$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/payment options/i);
    expect(sms).toBeUndefined();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
