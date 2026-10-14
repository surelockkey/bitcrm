import type { Metadata } from "next";
import { COMPANY_LEGAL_NAME, PRIVACY_CONTACT_EMAIL } from "../privacy/policy";

export const metadata: Metadata = {
  title: "Support · BitCRM",
  description: `How to get help with the BitCRM app from ${COMPANY_LEGAL_NAME}.`,
};

/**
 * The public support page App Store Connect links from the listing. Static,
 * outside the signed-in shell, one mailbox — the privacy policy's.
 */
export default function SupportPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold tracking-wide text-muted-foreground">BitCRM</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">BitCRM Support</h1>
      <p className="mt-6 leading-7 text-pretty">
        BitCRM is the field-service app of {COMPANY_LEGAL_NAME}, a locksmith and security services company in
        Connecticut. Our office and technicians use it to schedule jobs, keep customer records, send estimates and
        invoices, and take payments at the door.
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight">Signing in</h2>
        <p className="mt-3 leading-7 text-pretty">
          Accounts are created by our office for employees and subcontractors; there is no public sign-up. If you work
          with us and cannot sign in, use &ldquo;Forgot password?&rdquo; on the sign-in screen, or ask your dispatcher to
          resend your invitation.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight">Customers</h2>
        <p className="mt-3 leading-7 text-pretty">
          Customers do not need the app. Estimates, invoices and receipts reach you by text message or e-mail, and the
          link in them opens your job in the client portal, where you can review and pay.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight">Getting help</h2>
        <p className="mt-3 leading-7 text-pretty">
          Questions about the app, a job, a payment or your account go to{" "}
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="font-medium text-primary underline underline-offset-4">
            {PRIVACY_CONTACT_EMAIL}
          </a>
          . Tell us your name, the job number if there is one, and what happened. We answer on business days.
        </p>
        <p className="mt-3 leading-7 text-pretty">
          How we handle your information is described in our{" "}
          <a href="/privacy" className="font-medium text-primary underline underline-offset-4">
            privacy policy
          </a>
          .
        </p>
      </section>
    </main>
  );
}
