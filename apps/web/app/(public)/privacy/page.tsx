import type { Metadata } from "next";
import { COMPANY_LEGAL_NAME, EFFECTIVE_DATE, INTRO, PRIVACY_CONTACT_EMAIL, SECTIONS, type Block } from "./policy";

export const metadata: Metadata = {
  title: "Privacy Policy · BitCRM",
  description: `How ${COMPANY_LEGAL_NAME} handles information in BitCRM and the BitCRM app.`,
};

/**
 * The public privacy policy, outside the signed-in shell: the URL App Store
 * Connect asks for, and the one a customer or technician can read without an
 * account. Static — no data, no client state, nothing to wait for.
 */
export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold tracking-wide text-muted-foreground">BitCRM</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">Privacy Policy</h1>
      <p className="mt-2 text-muted-foreground">Effective {EFFECTIVE_DATE}</p>
      <p className="mt-6 leading-7 text-pretty">{INTRO}</p>

      {SECTIONS.map((section) => (
        <section key={section.heading} className="mt-10">
          <h2 className="text-xl font-semibold tracking-tight">{section.heading}</h2>
          {section.body.map((block, i) => (
            <PolicyBlock key={i} block={block} />
          ))}
        </section>
      ))}

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight">Contact</h2>
        <p className="mt-3 leading-7 text-pretty">
          {COMPANY_LEGAL_NAME}, Connecticut, USA. Questions and requests about this policy or your
          information go to{" "}
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="font-medium text-primary underline underline-offset-4">
            {PRIVACY_CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>
    </main>
  );
}

function PolicyBlock({ block }: { block: Block }) {
  if (Array.isArray(block)) {
    return (
      <ul className="mt-3 list-disc space-y-2 pl-6 leading-7 text-pretty">
        {block.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  return <p className="mt-3 leading-7 text-pretty">{block}</p>;
}
