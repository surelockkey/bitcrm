import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type {
  BusinessProfile,
  Estimate,
  Invoice,
  JwtUser,
  PortalDocumentSummary,
  PortalLink,
  PortalView,
} from '@bitcrm/types';
import { BusinessProfileService } from '../business-profile/business-profile.service';
import { portalBaseUrl } from '../common/constants/services.constants';
import { EstimatesService } from '../estimates/estimates.service';
import { CrmClient } from '../integrations/crm.client';
import { DealClient } from '../integrations/deal.client';
import { InvoicesService } from '../invoices/invoices.service';
import { generatePortalToken, hashPortalToken, isPlausibleToken } from './portal-token';
import { PortalRepository, type StoredPortalLink } from './portal.repository';

type InvoiceSource = Pick<InvoicesService, 'listForContact' | 'getStored' | 'portalPdf'>;
type EstimateSource = Pick<EstimatesService, 'listForContact' | 'getStored' | 'portalPdf'>;

const notFound = () => new NotFoundException('This link is no longer valid');

function publicLink(link: StoredPortalLink): PortalLink {
  const { tokenHash: _hash, token: _t, url: _u, ...rest } = link;
  return rest;
}

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
    const { token, hash } = generatePortalToken();
    const stored: StoredPortalLink = {
      contactId,
      tokenHash: hash,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    };
    await this.repo.saveLink(stored, previous?.tokenHash);
    return { ...publicLink(stored), token, url: `${portalBaseUrl()}/portal/${token}` };
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
    const contactId = await this.resolveToken(token);
    const source: InvoiceSource | EstimateSource | null =
      kind === 'invoice' ? this.invoices : kind === 'estimate' ? this.estimates : null;
    if (!source) throw new NotFoundException('Document not found');
    const doc = await source.getStored(id);
    // Same answer for "not yours", "not sent" and "doesn't exist".
    if (!doc || doc.contactId !== contactId || !doc.sentAt) {
      throw new NotFoundException('Document not found');
    }
    return source.portalPdf(id, download);
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
    const [contact, invoices, estimates, jobCompanies, companies] = await Promise.all([
      this.crm.getContact(contactId).catch(() => null),
      this.invoices.listForContact(contactId),
      this.estimates.listForContact(contactId),
      this.jobCompanies(contactId),
      this.profiles.listAll(),
    ]);
    if (!contact && !preview) throw notFound();

    const byId = new Map(companies.map((c) => [c.id, c]));
    const fallback = companies.find((c) => c.isDefault) ?? companies[0];
    const companyOf = (dealId: string): BusinessProfile | undefined => {
      const id = jobCompanies.get(dealId);
      return (id && byId.get(id)) || fallback;
    };

    const visible = <T extends { sentAt?: string }>(docs: T[]) => (preview ? docs : docs.filter((d) => !!d.sentAt));
    const shownInvoices = visible(invoices);
    const shownEstimates = visible(estimates);

    const lastSent = [...shownInvoices, ...shownEstimates]
      .filter((d) => !!d.sentAt)
      .sort((a, b) => b.sentAt!.localeCompare(a.sentAt!))[0];
    const headerId = lastSent ? jobCompanies.get(lastSent.dealId) : undefined;
    const business = await this.profiles.getPublic(headerId && byId.has(headerId) ? headerId : undefined);

    const named = (s: PortalDocumentSummary, dealId: string): PortalDocumentSummary => {
      const name = companyOf(dealId)?.name;
      return name ? { ...s, companyName: name } : s;
    };
    const byDateDesc = (a: PortalDocumentSummary, b: PortalDocumentSummary) => b.date.localeCompare(a.date);
    return {
      business,
      client: { firstName: contact?.firstName ?? '', lastName: contact?.lastName ?? '' },
      invoices: shownInvoices.map((i) => named(invoiceSummary(i), i.dealId)).sort(byDateDesc),
      estimates: shownEstimates.map((e) => named(estimateSummary(e), e.dealId)).sort(byDateDesc),
      preview,
    };
  }

  /** dealId → businessProfileId for the contact's jobs (empty on failure). */
  private async jobCompanies(contactId: string): Promise<Map<string, string>> {
    if (!this.deals) return new Map();
    try {
      const rows = await this.deals.listByContact(contactId);
      return new Map(rows.filter((r) => r.businessProfileId).map((r) => [r.id, r.businessProfileId!]));
    } catch (err) {
      this.logger.warn(`portal: job companies unavailable for ${contactId}: ${(err as Error).message}`);
      return new Map();
    }
  }
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
  };
}

function estimateSummary(e: Estimate): PortalDocumentSummary {
  return {
    kind: 'estimate',
    id: e.id,
    number: e.number,
    date: e.estimateDate,
    status: e.status,
    total: e.totals?.total ?? 0,
    ...(e.name && { name: e.name }),
    sent: !!e.sentAt,
  };
}
