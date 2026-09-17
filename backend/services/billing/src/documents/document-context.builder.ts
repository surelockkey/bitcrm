import { Injectable, Logger } from '@nestjs/common';
import {
  calculateDocumentTotals,
  lineAmount,
  type Address,
  type Company,
  type DocumentBlock,
  type DocumentRenderContext,
  type DocumentRow,
  type DocumentTemplateContent,
  type EstimateWithItems,
  type InvoiceView,
} from '@bitcrm/types';
import { AssetsService } from '../assets/assets.service';
import { BusinessProfileService } from '../business-profile/business-profile.service';
import { formatDisplayDate, resolveTimezone } from '../common/dates';
import { CrmClient, type BillingContact } from '../integrations/crm.client';
import { DealClient, type DealBillingView } from '../integrations/deal.client';
import { paymentTermsLabel, termDays } from '../invoices/invoice-rules';

export type BillingDocumentKind = 'invoice' | 'estimate';
export type BillingDocument = InvoiceView | EstimateWithItems;

export function formatAddress(a: Partial<Address> | string | undefined | null): string | undefined {
  if (!a) return undefined;
  if (typeof a === 'string') return a.trim() || undefined;
  const cityLine = [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const parts = [a.street, a.unit, cityLine].map((p) => (p ?? '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

function customFieldString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(customFieldString).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Every asset id an image block of the template references. */
export function templateAssetIds(t: Pick<DocumentTemplateContent, 'header' | 'body' | 'footer'>): string[] {
  const ids = new Set<string>();
  const visit = (rows: DocumentRow[] | undefined) => {
    for (const row of rows ?? []) {
      for (const col of row.columns ?? []) {
        for (const block of (col.blocks ?? []) as DocumentBlock[]) {
          if (block.type === 'image' && block.assetId) ids.add(block.assetId);
        }
      }
    }
  };
  visit(t.header);
  visit(t.body);
  visit(t.footer);
  return [...ids];
}

/**
 * `buildDocumentContext(kind, doc)`: everything a template can print, from
 * the document, its job, the client and the job's company (business profile). Peer lookups
 * are best effort — a missing contact renders a blank, it never fails the PDF.
 */
@Injectable()
export class DocumentContextBuilder {
  private readonly logger = new Logger(DocumentContextBuilder.name);

  constructor(
    private readonly deal: DealClient,
    private readonly crm: CrmClient,
    private readonly profiles: BusinessProfileService,
    private readonly assets: AssetsService,
  ) {}

  async build(
    kind: BillingDocumentKind,
    doc: BillingDocument,
    view: DealBillingView,
    template: Pick<DocumentTemplateContent, 'header' | 'body' | 'footer'>,
  ): Promise<DocumentRenderContext> {
    const deal = view.deal;
    const [profile, contact, company, areas, fieldDefs] = await Promise.all([
      // The job's company; unknown/absent → the default company.
      this.profiles.get(deal.businessProfileId ?? view.businessProfileId),
      this.safe(() => this.crm.getContact(doc.contactId ?? deal.contactId)),
      doc.companyId ?? deal.companyId
        ? this.safe(() => this.crm.getCompany((doc.companyId ?? deal.companyId)!))
        : Promise.resolve(null),
      deal.serviceAreaId ? this.deal.listServiceAreas() : Promise.resolve([]),
      deal.customFields ? this.deal.listCustomFields() : Promise.resolve([]),
    ]);
    const area = areas.find((a) => a.id === deal.serviceAreaId);
    const tz = resolveTimezone(area?.timezone);

    const assetIds = templateAssetIds(template);
    const [logoUrl, ...assetUris] = await Promise.all([
      profile.logoAssetId ? this.assets.getDataUri(profile.logoAssetId) : Promise.resolve(undefined),
      ...assetIds.map((id) => this.assets.getDataUri(id)),
    ]);
    const assets: Record<string, string> = {};
    assetIds.forEach((id, i) => {
      if (assetUris[i]) assets[id] = assetUris[i]!;
    });

    const names = new Map(fieldDefs.map((f) => [f.id, f.name]));
    const customFields: Record<string, string> = {};
    for (const [id, value] of Object.entries(deal.customFields ?? {})) {
      const s = customFieldString(value);
      if (s) customFields[names.get(id) ?? id] = s;
    }

    const first = deal.clientName?.firstName ?? (contact as BillingContact | null)?.firstName ?? '';
    const last = deal.clientName?.lastName ?? (contact as BillingContact | null)?.lastName ?? '';
    const jobAddress = formatAddress(deal.address);

    const isInvoice = kind === 'invoice';
    const inv = doc as InvoiceView;
    const est = doc as EstimateWithItems;

    const lines = isInvoice
      ? inv.items.map((i) => ({ ...i }))
      : est.items.map((i) => ({ ...i, amount: lineAmount(i) }));

    const totals = isInvoice
      ? inv.totals
      : calculateDocumentTotals({
          lines: est.items,
          taxRatePercent: est.taxSource === 'exempt' ? 0 : est.taxRatePercent ?? 0,
          discount: est.discount,
        });

    return {
      kind,
      business: {
        name: profile.name,
        legalName: profile.legalName,
        phone: profile.phone,
        email: profile.email,
        website: profile.website,
        licenseNumber: profile.licenseNumber,
        address: formatAddress(profile.address),
        logoUrl,
      },
      client: {
        firstName: first,
        lastName: last,
        fullName: [first, last].filter(Boolean).join(' '),
        companyName: (company as Company | null)?.title,
        email: contact?.emails?.[0],
        phone: contact?.phones?.[0],
        address: formatAddress(contact?.addresses?.[0]) ?? jobAddress,
        billingAddress: formatAddress((company as Company | null)?.address) ?? formatAddress(contact?.addresses?.[0]),
      },
      job: {
        number: deal.dealNumber,
        address: jobAddress,
        jobType: view.jobTypeName,
        serviceArea: area?.name ?? deal.serviceArea,
        scheduledDate: formatDisplayDate(deal.scheduledDate, tz),
        technicians: view.technicianNames?.length ? view.technicianNames.join(', ') : undefined,
        poNumber: deal.poNumber,
        customFields,
      },
      document: {
        number: doc.number,
        date: formatDisplayDate(isInvoice ? inv.invoiceDate : est.estimateDate, tz) ?? '',
        dueDate: isInvoice ? formatDisplayDate(inv.dueDate, tz) : undefined,
        paymentTerms: isInvoice ? paymentTermsLabel(inv.paymentTerms, this.daysBetween(inv)) : undefined,
        status: doc.status,
        name: isInvoice ? undefined : est.name,
        notes: doc.notes,
      },
      items: lines.map((l) => ({
        name: l.name,
        ...(l.description && { description: l.description }),
        ...(l.sku && { sku: l.sku }),
        quantity: l.quantity,
        unitPrice: l.priceClient,
        amount: l.amount,
        taxable: l.taxable !== false,
      })),
      totals: {
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxRateName: isInvoice ? inv.taxRateName : est.taxRateName,
        taxRatePercent: totals.taxRatePercent,
        tax: totals.tax,
        total: totals.total,
        amountPaid: totals.amountPaid,
        balanceDue: totals.balanceDue,
      },
      assets,
      currency: 'USD',
      today: formatDisplayDate(new Date().toISOString(), tz) ?? '',
    };
  }

  /** Custom terms have no stored day count; show the actual span. */
  private daysBetween(inv: InvoiceView): number | undefined {
    if (inv.paymentTerms !== 'custom') return termDays(inv.paymentTerms);
    const a = Date.parse(`${inv.invoiceDate}T00:00:00Z`);
    const b = Date.parse(`${inv.dueDate}T00:00:00Z`);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : undefined;
  }

  private async safe<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`document context lookup failed: ${(err as Error).message}`);
      return null;
    }
  }
}
