import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  estimateDepositDue,
  type BusinessProfile,
  type Estimate,
  type EstimateWithItems,
  type Invoice,
  type InvoiceView,
  type JwtUser,
  type Payment,
  type PortalDocumentSummary,
  type PortalJob,
  type PortalLink,
  type PortalPaymentLine,
  type PortalProposalSummary,
  type PortalView,
} from '@bitcrm/types';
import { AssetsService } from '../assets/assets.service';
import { BusinessProfileService } from '../business-profile/business-profile.service';
import { PaymentSettingsService } from '../payments/payment-settings.service';
import { summarizePayments, round2 } from '../payments/payment-rules';
import { PaymentsRepository } from '../payments/payments.repository';
import { StripeService } from '../payments/stripe/stripe.service';
import { portalBaseUrl } from '../common/constants/services.constants';
import { EstimatesService, type SignEstimateInput } from '../estimates/estimates.service';
import { CrmClient } from '../integrations/crm.client';
import { DealClient, type ContactDealSummary } from '../integrations/deal.client';
import { formatAddress } from '../documents/document-context.builder';
import { invoiceAwaitsSignature } from '../invoices/invoice-rules';
import { InvoicesService, type SignInvoiceInput } from '../invoices/invoices.service';
import { ProposalsService } from '../proposals/proposals.service';
import { generatePortalToken, hashPortalToken, isPlausibleToken, recoverPortalToken } from './portal-token';
import { PortalRepository, type StoredPortalLink } from './portal.repository';

type InvoiceSource = Pick<InvoicesService, 'listForContact' | 'getStored' | 'portalPdf' | 'portalHtml' | 'signByClient'>;
type EstimateSource = Pick<
  EstimatesService,
  'listForContact' | 'getStored' | 'portalPdf' | 'portalHtml' | 'approveByClient' | 'declineByClient'
>;

const notFound = () => new NotFoundException('This link is no longer valid');

function publicLink(link: StoredPortalLink): PortalLink {
  const { tokenHash: _hash, nonce: _n, token: _t, url: _u, replaced: _r, ...rest } = link;
  return rest;
}

/** What a client is sent: the portal origin plus the bearer token, nothing else. */
export const portalUrl = (token: string) => `${portalBaseUrl()}/${token}`;

/**
 * The client portal: one bearer link per contact listing the client's
 * invoices and estimates. Only documents that were sent are visible; the
 * authenticated preview shows everything.
 */
@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    private readonly repo: PortalRepository,
    private readonly crm: CrmClient,
    private readonly invoices: InvoicesService,
    private readonly estimates: EstimatesService,
    private readonly profiles: BusinessProfileService,
    @Optional() private readonly deals?: DealClient,
    // The payment ledger, so a payable invoice can say so in the portal list.
    // Optional: the portal works unchanged with no payments wiring at all.
    @Optional() @Inject(PaymentsRepository) private readonly ledger?: PaymentsRepository,
    @Optional() @Inject(PaymentSettingsService) private readonly paymentSettings?: PaymentSettingsService,
    @Optional() @Inject(StripeService) private readonly stripe?: StripeService,
    @Optional() @Inject(ProposalsService) private readonly proposals?: ProposalsService,
    @Optional() @Inject(AssetsService) private readonly assets?: AssetsService,
  ) {}

  async getLink(contactId: string): Promise<PortalLink | null> {
    const link = await this.repo.getLink(contactId);
    return link ? publicLink(link) : null;
  }

  /** Creates or regenerates the contact's link; the old token stops working. */
  async createLink(contactId: string, user: JwtUser): Promise<PortalLink> {
    const contact = await this.crm.getContact(contactId);
    if (!contact) throw new NotFoundException('Contact not found');
    const previous = await this.repo.getLink(contactId);
    const { token, hash, nonce } = generatePortalToken(contactId);
    const stored: StoredPortalLink = {
      contactId,
      tokenHash: hash,
      ...(nonce && { nonce }),
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    };
    await this.repo.saveLink(stored, previous?.tokenHash);
    return { ...publicLink(stored), token, url: portalUrl(token) };
  }

  /**
   * The contact's link WITH its URL, without invalidating the one the client
   * already has: an existing link is rebuilt from its nonce. Only a contact
   * with no link — or one made before tokens were recoverable, which can
   * never show its URL again — gets a fresh one (`replaced` says which).
   */
  async linkUrl(contactId: string, user: JwtUser): Promise<PortalLink> {
    const existing = await this.repo.getLink(contactId);
    if (existing) {
      const token = recoverPortalToken(contactId, existing.nonce, existing.tokenHash);
      if (token) return { ...publicLink(existing), token, url: portalUrl(token) };
    }
    const created = await this.createLink(contactId, user);
    return existing ? { ...created, replaced: true } : created;
  }

  async deleteLink(contactId: string): Promise<void> {
    const link = await this.repo.getLink(contactId);
    if (!link) throw new NotFoundException('This contact has no portal link');
    await this.repo.deleteLink(contactId, link.tokenHash);
  }

  preview(contactId: string): Promise<PortalView> {
    return this.buildView(contactId, true);
  }

  async publicView(token: string): Promise<PortalView> {
    const contactId = await this.resolveToken(token);
    const view = await this.buildView(contactId, false);
    await this.repo
      .touchViewed(contactId, new Date().toISOString())
      .catch((err: Error) => this.logger.warn(`lastViewedAt not recorded: ${err.message}`));
    return view;
  }

  async publicPdf(token: string, kind: string, id: string, download = false): Promise<{ url: string }> {
    const source = await this.sentDocumentSource(token, kind, id);
    return source.portalPdf(id, download);
  }

  /** The document as the on-screen HTML the portal shows first (the PDF is the download). */
  async publicHtml(token: string, kind: string, id: string): Promise<{ html: string }> {
    const source = await this.sentDocumentSource(token, kind, id);
    return source.portalHtml(id);
  }

  /** The contact a portal token belongs to. Throws the same 404 as everything else. */
  resolveContact(token: string): Promise<string> {
    return this.resolveToken(token);
  }

  /**
   * The token's own, SENT invoice — the gate every public payment route goes
   * through. Same answer for "not yours", "not sent" and "doesn't exist".
   */
  async sentInvoiceFor(token: string, invoiceId: string): Promise<Invoice> {
    const contactId = await this.resolveToken(token);
    const invoice = await this.invoices.getStored(invoiceId);
    if (!invoice || invoice.contactId !== contactId || !invoice.sentAt) {
      throw new NotFoundException('Document not found');
    }
    return invoice;
  }

  // ------------------------------------------------ the client's decisions

  /**
   * Approve = sign (Workiz: an estimate cannot be approved without a
   * signature). The deposit, if any, is collected by the payments flow right
   * after — see `PortalPaymentsService`.
   */
  async approveEstimate(token: string, estimateId: string, input: SignEstimateInput): Promise<EstimateWithItems> {
    await this.sentEstimateFor(token, estimateId);
    const approved = await this.estimates.approveByClient(estimateId, input);
    // An option of a proposal: the proposal is decided and the other options declined.
    await this.proposals?.onEstimateApproved(estimateId).catch((err: Error) =>
      this.logger.warn(`proposal not updated after approving ${estimateId}: ${err.message}`),
    );
    return approved;
  }

  async declineEstimate(token: string, estimateId: string, input: { reason?: string }): Promise<EstimateWithItems> {
    await this.sentEstimateFor(token, estimateId);
    const declined = await this.estimates.declineByClient(estimateId, input);
    await this.proposals?.onEstimateDeclined(estimateId).catch((err: Error) =>
      this.logger.warn(`proposal not updated after declining ${estimateId}: ${err.message}`),
    );
    return declined;
  }

  /** "Request signature" on an invoice: the client signs before paying. */
  async signInvoice(token: string, invoiceId: string, input: SignInvoiceInput): Promise<InvoiceView> {
    await this.sentInvoiceFor(token, invoiceId);
    return this.invoices.signByClient(invoiceId, input);
  }

  /** The token's own, SENT estimate — same 404 for "not yours", "not sent" and "doesn't exist". */
  async sentEstimateFor(token: string, estimateId: string): Promise<Estimate> {
    const contactId = await this.resolveToken(token);
    const estimate = await this.estimates.getStored(estimateId);
    if (!estimate || estimate.contactId !== contactId || !estimate.sentAt) {
      throw new NotFoundException('Document not found');
    }
    return estimate;
  }

  /** Resolves the token and proves the document is one of that contact's SENT ones. */
  private async sentDocumentSource(token: string, kind: string, id: string): Promise<InvoiceSource | EstimateSource> {
    const contactId = await this.resolveToken(token);
    const source: InvoiceSource | EstimateSource | null =
      kind === 'invoice' ? this.invoices : kind === 'estimate' ? this.estimates : null;
    if (!source) throw new NotFoundException('Document not found');
    const doc = await source.getStored(id);
    // Same answer for "not yours", "not sent" and "doesn't exist".
    if (!doc || doc.contactId !== contactId || !doc.sentAt) {
      throw new NotFoundException('Document not found');
    }
    return source;
  }

  private async resolveToken(token: string): Promise<string> {
    if (!isPlausibleToken(token)) throw notFound();
    const contactId = await this.repo.findContactByTokenHash(hashPortalToken(token));
    if (!contactId) throw notFound();
    return contactId;
  }

  /**
   * The portal is branded with the company of the client's most recently
   * SENT document (fallback: the default company); every summary names its
   * job's company. A job's company comes from deal-service (one call per
   * view); an outage just falls back to the default company.
   */
  private async buildView(contactId: string, preview: boolean): Promise<PortalView> {
    const [contact, invoices, estimates, jobs, companies, payments, proposals] = await Promise.all([
      this.crm.getContact(contactId).catch(() => null),
      this.invoices.listForContact(contactId),
      this.estimates.listForContact(contactId),
      this.contactJobs(contactId),
      this.profiles.listAll(),
      this.paymentHistory(contactId),
      this.proposals ? this.proposals.listForContact(contactId).catch(() => []) : Promise.resolve([]),
    ]);
    if (!contact && !preview) throw notFound();
    const jobCompanies = new Map(jobs.filter((r) => r.businessProfileId).map((r) => [r.id, r.businessProfileId!]));

    const byId = new Map(companies.map((c) => [c.id, c]));
    const fallback = companies.find((c) => c.isDefault) ?? companies[0];
    // A client document (no job) is branded with the default company.
    const companyOf = (dealId: string | undefined): BusinessProfile | undefined => {
      const id = dealId ? jobCompanies.get(dealId) : undefined;
      return (id && byId.get(id)) || fallback;
    };

    const visible = <T extends { sentAt?: string }>(docs: T[]) => (preview ? docs : docs.filter((d) => !!d.sentAt));
    const shownInvoices = visible(invoices);
    const shownEstimates = visible(estimates);

    const lastSent = [...shownInvoices, ...shownEstimates]
      .filter((d) => !!d.sentAt)
      .sort((a, b) => b.sentAt!.localeCompare(a.sentAt!))[0];
    const headerId = lastSent?.dealId ? jobCompanies.get(lastSent.dealId) : undefined;
    const business = await this.profiles.getPublic(headerId && byId.has(headerId) ? headerId : undefined);

    const named = (s: PortalDocumentSummary, dealId: string | undefined): PortalDocumentSummary => {
      const name = companyOf(dealId)?.name;
      return name ? { ...s, companyName: name } : s;
    };
    const [payable, deposits] = await Promise.all([
      this.payableFlags(shownInvoices),
      this.depositFlags(shownEstimates),
    ]);
    const byDateDesc = (a: PortalDocumentSummary, b: PortalDocumentSummary) => b.date.localeCompare(a.date);
    const estimateSummaries = (
      await Promise.all(
        shownEstimates.map(async (e) => ({
          ...named(estimateSummary(e), e.dealId),
          ...(deposits.get(e.id) ?? {}),
          ...(await this.coverUrl(e)),
        })),
      )
    ).sort(byDateDesc);
    const byEstimateId = new Map(estimateSummaries.map((e) => [e.id, e]));
    const proposalSummaries: PortalProposalSummary[] = proposals
      .map((p) => ({
        ...p,
        options: p.estimateIds.map((id) => byEstimateId.get(id)).filter((e): e is PortalDocumentSummary => !!e),
      }))
      // Nothing sent in it that the client may see ⇒ nothing to show.
      .filter((p) => p.options.length > 0)
      .map((p) => ({ ...p, ...(p.options[0].companyName && { companyName: p.options[0].companyName }) }));
    return {
      business,
      client: {
        firstName: contact?.firstName ?? '',
        lastName: contact?.lastName ?? '',
        ...(contact?.emails?.[0] && { email: contact.emails[0] }),
        ...(contact?.phones?.[0] && { phone: contact.phones[0] }),
      },
      jobs: portalJobs(jobs, new Date()),
      payments,
      invoices: shownInvoices
        .map((i) => ({ ...named(invoiceSummary(i), i.dealId), ...(payable.get(i.id) ?? {}) }))
        .sort(byDateDesc),
      estimates: estimateSummaries,
      proposals: proposalSummaries,
      preview,
    };
  }

  /**
   * Which invoices the client can actually pay right now, and what is still
   * clearing on each. Best effort — a ledger outage must not take the portal
   * down, it just hides the Pay button.
   *
   * "Request signature" is part of the answer: such an invoice is `payable`
   * THROUGH signing — `signatureNeeded` sends its Pay button to the Sign & pay
   * drawer (the portal's only way to sign an invoice), and the pay route
   * refuses with 409 until the signature is on file. Both read
   * `invoiceAwaitsSignature`, so they cannot disagree.
   */
  private async payableFlags(
    invoices: Invoice[],
  ): Promise<Map<string, { payable: boolean; signatureNeeded: boolean; amountPending: number; balanceDue: number }>> {
    const out = new Map<string, { payable: boolean; signatureNeeded: boolean; amountPending: number; balanceDue: number }>();
    if (!this.ledger || !this.paymentSettings || invoices.length === 0) return out;
    try {
      const settings = await this.paymentSettings.get();
      // Both Stripe keys, or the client would be offered a form that cannot load.
      const stripeReady = !!this.stripe?.onlineReady;
      for (const invoice of invoices) {
        const summary = summarizePayments(await this.ledger.listByInvoice(invoice.id));
        const balanceDue = round2(Math.max(0, (invoice.totals?.total ?? 0) - summary.settled));
        const methods = this.paymentSettings.methodsFor(settings, invoice.allowedMethods, stripeReady);
        out.set(invoice.id, {
          // Every Pay button in the portal is gated on this: Stripe configured,
          // the document actually sent, a method allowed, something owed — and
          // a job, since the ledger cannot take a payment on a client invoice yet.
          payable: methods.length > 0 && balanceDue > 0 && !!invoice.sentAt && !!invoice.dealId,
          signatureNeeded: invoiceAwaitsSignature(invoice),
          amountPending: summary.pending,
          balanceDue,
        });
      }
    } catch (err) {
      this.logger.warn(`portal: payment ledger unavailable: ${(err as Error).message}`);
    }
    return out;
  }

  /**
   * Which estimates can take their deposit right now (approved = signed, a
   * deposit set, part of it still owed, a job to hold the money, Stripe
   * ready), and how much of the deposit already settled. Best effort, like
   * `payableFlags`.
   */
  private async depositFlags(estimates: Estimate[]): Promise<Map<string, { payable: boolean; depositPaid: number }>> {
    const out = new Map<string, { payable: boolean; depositPaid: number }>();
    const withDeposit = estimates.filter((e) => estimateDepositDue(e) > 0);
    if (!this.ledger || !this.paymentSettings || withDeposit.length === 0) return out;
    try {
      const settings = await this.paymentSettings.get();
      const stripeReady = !!this.stripe?.onlineReady;
      const methods = this.paymentSettings.methodsFor(settings, undefined, stripeReady);
      const ledgers = new Map<string, Promise<Awaited<ReturnType<PaymentsRepository['listByInvoice']>>>>();
      for (const estimate of withDeposit) {
        if (!estimate.dealId) {
          out.set(estimate.id, { payable: false, depositPaid: 0 });
          continue;
        }
        if (!ledgers.has(estimate.dealId)) ledgers.set(estimate.dealId, this.ledger.listByInvoice(estimate.dealId));
        const rows = (await ledgers.get(estimate.dealId)!).filter((p) => p.estimateId === estimate.id);
        const depositPaid = summarizePayments(rows).settled;
        const owed = round2(Math.max(0, estimateDepositDue(estimate) - depositPaid));
        out.set(estimate.id, {
          payable: methods.length > 0 && owed > 0 && estimate.status === 'approved',
          depositPaid,
        });
      }
    } catch (err) {
      this.logger.warn(`portal: payment ledger unavailable for deposits: ${(err as Error).message}`);
    }
    return out;
  }

  /** A proposal option's cover image, signed for an hour (best effort). */
  private async coverUrl(e: Estimate): Promise<Pick<PortalDocumentSummary, 'coverUrl'>> {
    if (!e.coverAssetId || !this.assets) return {};
    try {
      return { coverUrl: (await this.assets.getUrl(e.coverAssetId)).url };
    } catch {
      return {};
    }
  }

  /** The contact's jobs from deal-service (empty on failure — the portal still opens). */
  private async contactJobs(contactId: string): Promise<ContactDealSummary[]> {
    if (!this.deals) return [];
    try {
      return await this.deals.listByContact(contactId);
    } catch (err) {
      this.logger.warn(`portal: jobs unavailable for ${contactId}: ${(err as Error).message}`);
      return [];
    }
  }

  /** The client's own payments, newest first, without failed attempts (empty when the ledger is not wired or down). */
  private async paymentHistory(contactId: string): Promise<PortalPaymentLine[]> {
    if (!this.ledger) return [];
    try {
      const { items } = await this.ledger.list({ contactId, limit: 200 });
      return items
        .filter((p) => p.status !== 'failed')
        .sort((a, b) => b.takenAt.localeCompare(a.takenAt))
        .map(paymentLine);
    } catch (err) {
      this.logger.warn(`portal: payment history unavailable for ${contactId}: ${(err as Error).message}`);
      return [];
    }
  }
}

/** Workiz My Booking: Upcoming = submitted jobs scheduled from now on; Completed = done. The rest are not shown. */
export function portalJobs(rows: ContactDealSummary[], now: Date): PortalJob[] {
  const nowIso = now.toISOString();
  const toJob = (r: ContactDealSummary, kind: PortalJob['kind']): PortalJob => ({
    id: r.id,
    number: r.dealNumber,
    kind,
    ...(r.scheduledDate && { scheduledDate: r.scheduledDate }),
    ...(r.scheduledEndDate && { scheduledEndDate: r.scheduledEndDate }),
    ...(r.jobTimezone && { timezone: r.jobTimezone }),
    ...(r.jobTypeName && { jobType: r.jobTypeName }),
    ...(formatAddress(r.address) && { address: formatAddress(r.address)! }),
    technicians: r.technicianNames ?? [],
  });
  const upcoming = rows
    .filter((r) => r.superStatus === 'submitted' && !!r.scheduledDate && r.scheduledDate >= nowIso)
    .sort((a, b) => a.scheduledDate!.localeCompare(b.scheduledDate!))
    .map((r) => toJob(r, 'upcoming'));
  const completed = rows
    .filter((r) => r.superStatus === 'done')
    .sort((a, b) => (b.scheduledDate ?? '').localeCompare(a.scheduledDate ?? ''))
    .map((r) => toJob(r, 'completed'));
  return [...upcoming, ...completed];
}

function paymentLine(p: Payment): PortalPaymentLine {
  return {
    id: p.id,
    amount: p.amount,
    method: p.method,
    status: p.status,
    takenAt: p.takenAt,
    ...(p.invoiceId && { invoiceId: p.invoiceId }),
    ...(p.estimateId && { estimateId: p.estimateId }),
    ...(p.cardBrand && { cardBrand: p.cardBrand }),
    ...(p.last4 && { last4: p.last4 }),
  };
}

function invoiceSummary(i: Invoice): PortalDocumentSummary {
  return {
    kind: 'invoice',
    id: i.id,
    number: i.number,
    date: i.invoiceDate,
    status: i.status,
    total: i.totals?.total ?? 0,
    balanceDue: i.totals?.balanceDue ?? 0,
    dueDate: i.dueDate,
    sent: !!i.sentAt,
    signatureNeeded: invoiceAwaitsSignature(i),
    signed: !!i.signedAt,
  };
}

function estimateSummary(e: Estimate): PortalDocumentSummary {
  const depositDue = estimateDepositDue(e);
  return {
    kind: 'estimate',
    id: e.id,
    number: e.number,
    date: e.estimateDate,
    status: e.status,
    total: e.totals?.total ?? 0,
    ...(e.name && { name: e.name }),
    ...(e.description && { description: e.description }),
    sent: !!e.sentAt,
    ...(e.proposalId && { proposalId: e.proposalId }),
    // Still open ⇒ approving it means signing it.
    signatureNeeded: !!e.sentAt && (e.status === 'pending' || e.status === 'unsent'),
    signed: e.approvedVia === 'portal',
    ...(depositDue > 0 && { depositDue }),
  };
}
