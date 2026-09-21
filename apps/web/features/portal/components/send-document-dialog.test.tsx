import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
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

function handlers(over: { contact?: object; smsStatus?: number; markSentStatus?: number } = {}) {
  server.use(
    http.get("*/crm/contacts/c1", () => HttpResponse.json({ success: true, data: over.contact ?? contact })),
    http.get("*/billing/business-profiles", () =>
      HttpResponse.json({ success: true, data: [{ id: "bp1", name: "Sure Lock Key", isDefault: true }] }),
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

function open(props: Partial<{ document: SendableDocument; markSent: () => Promise<unknown> }> = {}) {
  const onOpenChange = vi.fn();
  const markSent = props.markSent ?? vi.fn(async () => {
    await fetch("http://localhost/api/billing/invoices/d1/mark-sent", { method: "POST" }).catch(() => undefined);
  });
  renderWithClient(
    <SendDocumentDialog document={props.document ?? doc} open onOpenChange={onOpenChange} markSent={markSent} />,
  );
  return { onOpenChange, markSent };
}

beforeEach(() => {
  calls = [];
  sms = undefined;
  toast.success.mockClear();
  toast.error.mockClear();
  // A stable idempotency key.
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "11111111-1111-4111-8111-111111111111" });
});

describe("SendDocumentDialog", () => {
  it("prefills the text with the client's own portal link and the company name", async () => {
    handlers();
    open();
    const box = await ready();
    expect(box.value).toBe(`Hi Jane, your invoice #1042 from Sure Lock Key is ready ($348.50). View and pay it here: ${URL_}`);
    expect(screen.getByText(/Jane Client/)).toBeInTheDocument();
    expect(screen.getByText(/860\) 555-0199/)).toBeInTheDocument();
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
    await user().click(screen.getByRole("button", { name: /send text/i }));
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
    await user().click(screen.getByRole("button", { name: /send text/i }));
    await waitFor(() => expect(sms).toBeDefined());
    expect(markSent).not.toHaveBeenCalled();
  });

  it("sends the edited message", async () => {
    handlers();
    open({ document: { ...doc, alreadySent: true } });
    const box = await ready();
    await user().type(box, " Thanks!");
    await user().click(screen.getByRole("button", { name: /send text/i }));
    await waitFor(() => expect(sms?.body).toMatch(/Thanks!$/));
  });

  it("refuses to send once the link has been deleted from the text", async () => {
    handlers();
    open();
    const box = await ready();
    await user().clear(box);
    await user().type(box, "Your invoice is ready");
    expect(screen.getByText(/must contain the portal link/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send text/i })).toBeDisabled();
  });

  it("explains a client with no phone and disables sending", async () => {
    handlers({ contact: { ...contact, phones: [] } });
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent(/no phone number on file/i);
    expect(screen.getByRole("button", { name: /send text/i })).toBeDisabled();
  });

  it("still sends when the viewer may not see phone numbers (the server picks the client's number)", async () => {
    handlers({ contact: { ...contact, phones: [], phoneCount: 1, phonesMasked: true } });
    open({ document: { ...doc, alreadySent: true } });
    await ready();
    expect(screen.queryByText(/no phone number on file/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send text/i })).toBeEnabled();
  });

  it("keeps the dialog open and says why when the text is refused (opted out)", async () => {
    handlers({ smsStatus: 422 });
    const { onOpenChange } = open();
    await ready();
    await user().click(screen.getByRole("button", { name: /send text/i }));
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
    await user().click(screen.getByRole("button", { name: /send text/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/edited elsewhere/i);
    expect(sms).toBeUndefined();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("offers a retry when the portal link cannot be fetched", async () => {
    handlers();
    server.use(http.post("*/billing/portal-links/c1/url", () => HttpResponse.json({ success: false, message: "down" }, { status: 500 })));
    open();
    expect(await screen.findByText(/couldn't get the client's portal link/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send text/i })).toBeDisabled();
  });
});
