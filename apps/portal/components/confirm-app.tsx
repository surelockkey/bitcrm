"use client";

import { useState, type ReactNode } from "react";
import { CalendarDays, CheckCircle2, Clock, Link2Off, MapPin, RefreshCw, Wrench } from "lucide-react";
import type { ClientConfirmView } from "@bitcrm/types";
import { businessInitials, cx, isInvalidPortalError, telHref, useLoad } from "@bitcrm/portal-ui";
import { confirmAppointment, getConfirm } from "@/lib/api";
import { formatConfirmedAt, formatVisit } from "@/lib/visit-window";

/*
 * The portal's Workiz-white palette (packages/portal-ui/src/portal-view.tsx):
 * slate ink #3b4b52, secondary #637075, hairline #e9ebec, grey pane #f3f4f5,
 * green #50d58c, yellow #ffd503 for the one thing to do, link blue #6aa8ee.
 */
const SOFT = "text-[#637075]";
const CARD = "rounded-lg border border-[#e9ebec] bg-white shadow-[0_1px_3px_rgba(59,75,82,0.08)]";
const pill =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-[#6aa8ee] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60";
const yellowPill = cx(pill, "w-full bg-[#ffd503] text-[#3b4b52] hover:bg-[#f7d006]");
const outlinePill = cx(pill, "border border-[#3b4b52]/70 bg-white text-[#3b4b52] hover:bg-[#f3f4f5]");
const telLink = "font-semibold text-[#6aa8ee] hover:underline";

/**
 * The page a client's `{{confirm_link}}` opens (B12) — Workiz's "To confirm
 * your appointment click here": the company, the visit, the place, and one
 * Confirm button; then the thank-you. A job that is closed, or a visit that
 * is over, is explained with the number to call instead of a button.
 */
export function ConfirmApp({ token }: { token: string }) {
  const page = useLoad(() => getConfirm(token), token);
  const [answer, setAnswer] = useState<ClientConfirmView | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (page.loading && !page.data) return <ConfirmSkeleton />;
  if (page.error || !page.data) {
    if (isInvalidPortalError(page.error)) return <DeadLink />;
    return <LoadError onRetry={page.reload} retrying={page.loading} />;
  }

  const view = answer ?? page.data;

  const confirm = async () => {
    setBusy(true);
    setFailed(false);
    try {
      setAnswer(await confirmAppointment(token));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell business={view.business}>
      <StateHeading view={view} />
      <VisitDetails view={view} />
      {view.state === "open" ? (
        <div className="space-y-3">
          {failed ? (
            <p role="alert" className="text-sm text-[#e05c5c]">
              We couldn’t confirm your appointment. Please try again.
            </p>
          ) : null}
          <button type="button" onClick={confirm} disabled={busy} className={yellowPill}>
            Confirm
          </button>
        </div>
      ) : (
        <ContactLine view={view} />
      )}
    </Shell>
  );
}

function Shell({ business, children }: { business: ClientConfirmView["business"]; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[480px] px-4 py-8 text-[#3b4b52] sm:py-12">
      <div className={CARD}>
        <header className="flex items-center gap-3 border-b border-[#e9ebec] px-5 py-4">
          {business.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL from the API, not a static asset
            <img src={business.logoUrl} alt={business.name} className="h-10 w-auto max-w-[140px] flex-none object-contain" />
          ) : (
            <span aria-hidden className="flex size-10 flex-none items-center justify-center rounded-md bg-[#3b4b52] text-sm font-semibold text-white">
              {businessInitials(business.name)}
            </span>
          )}
          <p className="min-w-0 truncate text-[17px] leading-tight font-semibold">{business.name}</p>
        </header>
        <div className="space-y-6 px-5 py-6">{children}</div>
      </div>
    </div>
  );
}

const HEADINGS: Record<ClientConfirmView["state"], string> = {
  open: "Confirm your appointment",
  confirmed: "Thank you!",
  closed: "This appointment can’t be confirmed online",
  expired: "This appointment has already passed",
};

function StateHeading({ view }: { view: ClientConfirmView }) {
  const done = view.state === "confirmed";
  const when = done ? formatConfirmedAt(view.confirmedAt, view.job.timezone) : "";
  return (
    <div className="space-y-2">
      {done ? <CheckCircle2 className="size-10 text-[#50d58c]" aria-hidden /> : null}
      <h1 className="text-xl leading-snug font-semibold">{HEADINGS[view.state]}</h1>
      {view.state === "open" ? (
        <p className={cx("text-sm", SOFT)}>Please confirm your upcoming appointment with {view.business.name}.</p>
      ) : done ? (
        <>
          <p className="text-[15px]">Your appointment is confirmed.</p>
          {when ? <p className={cx("text-xs", SOFT)}>Confirmed {when}</p> : null}
        </>
      ) : view.state === "closed" ? (
        <p className={cx("text-sm", SOFT)}>It may already have been completed or canceled.</p>
      ) : null}
    </div>
  );
}

function VisitDetails({ view }: { view: ClientConfirmView }) {
  const { day, time } = formatVisit(view.job);
  return (
    <dl className="space-y-3 rounded-lg bg-[#f3f4f5] px-4 py-4 text-sm">
      <Row icon={<Wrench className="size-4" aria-hidden />} label="Job">
        {view.job.jobType ? <span className="block font-semibold">{view.job.jobType}</span> : null}
        <span className={cx("block text-xs", SOFT)}>Job #{view.job.number}</span>
      </Row>
      <Row icon={<CalendarDays className="size-4" aria-hidden />} label="When">
        <span className="block font-semibold">{day}</span>
        {time ? (
          <span className="mt-0.5 flex items-center gap-1.5">
            <Clock className={cx("size-3.5", SOFT)} aria-hidden />
            <span>{time}</span>
          </span>
        ) : null}
      </Row>
      {view.job.address ? (
        <Row icon={<MapPin className="size-4" aria-hidden />} label="Where">
          <span className="block">{view.job.address}</span>
        </Row>
      ) : null}
    </dl>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className={cx("mt-0.5 flex-none", SOFT)}>
        {icon}
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** After the button: who to call to change anything (the company's own phone when it has one). */
function ContactLine({ view }: { view: ClientConfirmView }) {
  const { name, phone } = view.business;
  const lead = view.state === "confirmed" ? "Need to make a change?" : "Questions?";
  return (
    <p className={cx("text-sm", SOFT)}>
      {lead}{" "}
      {phone ? (
        <>
          Call {name} at{" "}
          <a href={telHref(phone)} className={telLink}>
            {phone}
          </a>
          .
        </>
      ) : (
        <>Please contact {name}.</>
      )}
    </p>
  );
}

function ConfirmSkeleton() {
  const bar = "animate-pulse rounded-lg bg-[#f3f4f5]";
  return (
    <div className="mx-auto w-full max-w-[480px] space-y-4 px-4 py-8 sm:py-12" role="status" aria-busy aria-label="Loading your appointment">
      <div className={cx(bar, "h-16")} />
      <div className={cx(bar, "h-7 w-2/3")} />
      <div className={cx(bar, "h-32")} />
      <div className={cx(bar, "h-11")} />
    </div>
  );
}

function DeadLink() {
  return (
    <div className={cx("mx-auto mt-10 flex max-w-md flex-col items-center gap-3 p-8 text-center text-[#3b4b52]", CARD)}>
      <span className="flex size-12 items-center justify-center rounded-full bg-[#f3f4f5] text-[#637075]">
        <Link2Off className="size-6" aria-hidden />
      </span>
      <h1 className="text-lg font-semibold">This link is no longer valid</h1>
      <p className={cx("text-sm", SOFT)}>Please contact the business that sent it to you.</p>
    </div>
  );
}

function LoadError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div className={cx("mx-auto mt-10 flex max-w-md flex-col items-center gap-3 p-8 text-center text-[#3b4b52]", CARD)}>
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className={cx("text-sm", SOFT)}>We couldn’t load your appointment. Please try again.</p>
      <button type="button" onClick={onRetry} disabled={retrying} className={outlinePill}>
        <RefreshCw className={cx("size-4", retrying && "animate-spin")} aria-hidden /> Try again
      </button>
    </div>
  );
}
