import type { BusinessProfileView, Company, WorkOrder } from "@bitcrm/types";
import { formatPhone } from "@/lib/phone";
import { paymentTermsLabel } from "@/features/clients/lib";
import { addressLines } from "@/features/invoices/invoice-header";
import { workOrderPaperRows } from "../lib";

/** "5,000.00" — the paper prints figures as Workiz's template does, without the sign. */
const figure = (n: number | undefined) =>
  (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/*
 * Workiz's "Work Order" document template (pg_workorders_wz_07_5TU7ZA_paper,
 * the html_pdf its work order page renders): a letter page, 10pt Noto Sans /
 * Helvetica Neue in #666, rows of two 50% cells padded 10px — the logo and an
 * 18pt bold "WORK ORDER"; the business left and the Order NO. table right
 * (150px labels); "Client Details:"; the items table (Description 60% · QTY ·
 * Price · Amount, a 3px #666 rule over the header and 1px #3b4b52 under it,
 * the figures' columns closed by a dashed #dfe2e3 rule, 10px pads) with the
 * totals under the Price column; "Terms" 15.6px bold.
 */
const CELL = "w-1/2 p-2.5";
const TH = "px-2.5 pt-[15px] pb-2.5 text-left font-bold";
const TD = "px-2.5 py-2.5 pr-[25px] align-top";
const DASHED = "border-r border-dashed border-r-[#dfe2e3]";

export function WorkOrderPaper({
  workOrder,
  company,
  business,
  jobNumber,
}: {
  workOrder: WorkOrder;
  company: Company | undefined;
  /** The account's default company — the paper's letterhead, as Workiz prints the account's. */
  business: BusinessProfileView | undefined;
  jobNumber?: string;
}) {
  const rows = workOrderPaperRows(workOrder, { jobNumber });
  const letterhead = business
    ? [
        ...(business.legalName && business.legalName !== business.name ? [business.legalName] : []),
        ...(business.address ? addressLines(business.address) : []),
        ...(business.email ? [business.email] : []),
        ...(business.phone ? [formatPhone(business.phone)] : []),
        ...(business.website ? [business.website] : []),
      ]
    : [];
  const client = company
    ? [
        company.title,
        ...(company.address ? [company.address] : []),
        ...(company.phones?.[0] ? [formatPhone(company.phones[0])] : []),
        ...(company.emails?.[0] ? [company.emails[0]] : []),
      ]
    : [];
  const terms = company?.paymentTerms ? paymentTermsLabel(company.paymentTerms, company.customTermsDays) : null;

  return (
    <article
      aria-label={`Work order ${workOrder.woNumber}`}
      className="mx-auto w-full max-w-[816px] bg-background font-['Noto_Sans','Helvetica_Neue',sans-serif] text-[13.333px] leading-4 tracking-normal text-wz-text"
    >
      <div className="flex">
        <div className={CELL}>
          {business?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived presigned logo, as the paper prints it
            <img src={business.logoUrl} alt={business.name} className="max-h-[140px] max-w-[140px]" />
          ) : null}
        </div>
        <div className={`${CELL} min-h-[60px] text-right`}>
          <p className="text-[24px] leading-7 font-bold">WORK ORDER</p>
        </div>
      </div>

      <div className="flex">
        <div className={`${CELL} min-h-[60px]`}>
          {business ? (
            <>
              <p className="text-base leading-5 tracking-[0.4px]">{business.name}</p>
              {letterhead.map((line) => (
                <p key={line} className="break-words">
                  {line}
                </p>
              ))}
            </>
          ) : null}
        </div>
        <div className={CELL}>
          <table className="w-full">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <td className="w-[150px] pb-0.5">{label}</td>
                  <td className="pb-0.5">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex">
        <div className={CELL}>
          <p className="pb-0.5 font-bold">Client Details:</p>
          {client.map((line) => (
            <p key={line} className="pb-0.5 break-words">
              {line}
            </p>
          ))}
        </div>
        <div className={CELL} />
      </div>

      <div className="p-2.5">
        <table className="w-full border-collapse">
          <thead className="border-b border-b-[#3b4b52]">
            <tr className="border-t-[3px] border-t-wz-text">
              <th className={`${TH} w-[60%]`}>Description</th>
              <th className={`${TH} w-[15%]`}>QTY</th>
              <th className={`${TH} w-[15%]`}>Price</th>
              <th className={`${TH} w-[10%]`}>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-b-[#dddddd]">
              <td className={`${TD} ${DASHED} pb-[15px] whitespace-pre-line`}>{workOrder.description || `Work order ${workOrder.woNumber}`}</td>
              <td className={`${TD} ${DASHED} pb-[15px]`}>1</td>
              <td className={`${TD} ${DASHED} pb-[15px]`}>{figure(workOrder.amount)}</td>
              <td className={`${TD} ${DASHED} pb-[15px]`}>{figure(workOrder.amount)}</td>
            </tr>
            {(["Sub total", "Total"] as const).map((label) => (
              <tr key={label}>
                <td className={TD} />
                <td className={TD} />
                <td className={`${TD} ${DASHED} ${label === "Sub total" ? "pt-5" : ""}`}>{label}</td>
                <td className={`${TD} ${DASHED} ${label === "Sub total" ? "pt-5" : ""}`}>{figure(workOrder.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {terms ? (
        <div className="p-2.5">
          <h3 className="pb-2.5 text-[15.6px] leading-[18px] font-bold">Terms</h3>
          <p>{terms}</p>
        </div>
      ) : null}
    </article>
  );
}
