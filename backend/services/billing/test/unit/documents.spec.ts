jest.mock('src/documents/renderer', () => ({
  DOCUMENT_PRESETS: [],
  createTemplateContent: jest.fn(),
  validateTemplateContent: jest.fn(),
  renderDocumentHtml: jest.fn((_t: unknown, ctx: { document: { number: string } }, opts?: { mode?: string }) =>
    `<html>${ctx.document.number}:${opts?.mode ?? 'screen'}</html>`,
  ),
}));

import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import {
  PaymentTerms,
  type DocumentTemplate,
  type EstimateWithItems,
  type InvoiceView,
} from '@bitcrm/types';
import { DocumentContextBuilder } from 'src/documents/document-context.builder';
import { DocumentsService } from 'src/documents/documents.service';
import { resolveChromeExecutable } from 'src/documents/pdf.service';
import { AssetsService } from 'src/assets/assets.service';
import { pdfCacheHash } from 'src/documents/pdf-cache';
import * as renderer from 'src/documents/renderer';
import { NOW, billingView, dealProduct, mockCrmClient, mockDealClient, profile, user } from './mocks';

const template = (over: Partial<DocumentTemplate> = {}): DocumentTemplate =>
  ({
    id: 'tpl-default-invoice',
    name: 'Default',
    kind: 'invoice',
    isDefault: true,
    version: 2,
    page: {},
    header: [],
    body: [
      {
        id: 'r1',
        columns: [
          {
            id: 'c1',
            span: 12,
            blocks: [
              { id: 'b1', type: 'image', assetId: 'asset-1', widthPercent: 50 },
              { id: 'b2', type: 'text', content: { type: 'doc' } },
            ],
          },
        ],
      },
    ],
    footer: [{ id: 'r2', columns: [{ id: 'c2', span: 12, blocks: [{ id: 'b3', type: 'image', assetId: 'asset-2', widthPercent: 20 }] }] }],
    visibility: {},
    createdBy: 'u',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as DocumentTemplate;

const invoiceView = (over: Partial<InvoiceView> = {}): InvoiceView =>
  ({
    id: 'deal-1',
    number: 'K4T9ZW',
    dealId: 'deal-1',
    contactId: 'contact-1',
    invoiceDate: '2026-09-16',
    paymentTerms: PaymentTerms.NET_30,
    dueDate: '2026-10-16',
    status: 'due',
    notes: 'Thank you',
    items: [
      { lineId: 'p-1', productId: 'p-1', name: 'Rekey', sku: 'RK', quantity: 2, priceClient: 50, taxable: true, amount: 100 },
    ],
    totals: {
      lineCount: 1,
      subtotal: 100,
      taxableSubtotal: 100,
      nonTaxableSubtotal: 0,
      discount: 0,
      taxableBase: 100,
      taxRatePercent: 6.35,
      tax: 6.35,
      total: 106.35,
      amountPaid: 0,
      balanceDue: 106.35,
    },
    taxRateName: 'CT Sales',
    taxRatePercent: 6.35,
    version: 1,
    createdBy: 'u',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as InvoiceView;

describe('DocumentContextBuilder', () => {
  let deal: ReturnType<typeof mockDealClient>;
  let crm: ReturnType<typeof mockCrmClient>;
  let assets: { getDataUri: jest.Mock };
  let profiles: { get: jest.Mock };
  let builder: DocumentContextBuilder;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    deal = mockDealClient();
    crm = mockCrmClient();
    assets = { getDataUri: jest.fn(async (id: string) => `data:image/png;base64,${id}`) };
    profiles = {
      get: jest.fn(async () =>
        profile({
          phone: '+18605550000',
          logoAssetId: 'logo-1',
          address: { street: '9 Elm St', city: 'Hartford', state: 'CT', zip: '06103' },
        }),
      ),
    };
    builder = new DocumentContextBuilder(deal as never, crm as never, profiles as never, assets as never);
  });
  afterEach(() => jest.useRealTimers());

  it("renders the job's company (business.* and logo)", async () => {
    profiles.get.mockImplementation(async (id?: string) =>
      id === 'bp-2' ? profile({ id: 'bp-2', name: 'Second Brand', logoAssetId: 'logo-2' }) : profile(),
    );
    const ctx = await builder.build('invoice', invoiceView(), billingView({ businessProfileId: 'bp-2' }), template());
    expect(profiles.get).toHaveBeenCalledWith('bp-2');
    expect(ctx.business).toMatchObject({ name: 'Second Brand', logoUrl: 'data:image/png;base64,logo-2' });
  });

  it('builds business, client, job, document, items, totals and assets', async () => {
    crm.getCompany.mockResolvedValueOnce({ id: 'co-1', title: 'Acme LLC', address: '5 Oak Ave' });
    deal.listCustomFields.mockResolvedValueOnce([{ id: 'cf-1', name: 'Gate code' }]);
    const view = billingView({
      companyId: 'co-1',
      scheduledDate: '2026-09-20',
      poNumber: 'PO-7',
      address: { street: '1 Main St', unit: '2B', city: 'Hartford', state: 'CT', zip: '06103' },
      customFields: { 'cf-1': '1234', 'cf-x': true } as never,
    });

    const ctx = await builder.build('invoice', invoiceView(), view, template());

    expect(ctx.kind).toBe('invoice');
    expect(ctx.business).toMatchObject({
      name: 'Sure Lock Key',
      phone: '+18605550000',
      address: '9 Elm St, Hartford, CT 06103',
      logoUrl: 'data:image/png;base64,logo-1',
    });
    expect(ctx.client).toMatchObject({
      firstName: 'Jane',
      lastName: 'Client',
      fullName: 'Jane Client',
      companyName: 'Acme LLC',
      email: 'jane@example.com',
      phone: '+18605550100',
      address: '1 Main St, 2B, Hartford, CT 06103',
      billingAddress: '5 Oak Ave',
    });
    expect(ctx.job).toMatchObject({
      number: 'K4T9ZW',
      address: '1 Main St, 2B, Hartford, CT 06103',
      jobType: 'Lockout',
      serviceArea: 'Hartford',
      scheduledDate: 'Sep 20, 2026',
      technicians: 'Tom Tech',
      poNumber: 'PO-7',
      customFields: { 'Gate code': '1234', 'cf-x': 'Yes' },
    });
    expect(ctx.document).toMatchObject({
      number: 'K4T9ZW',
      date: 'Sep 16, 2026',
      dueDate: 'Oct 16, 2026',
      paymentTerms: 'Net 30',
      status: 'due',
      notes: 'Thank you',
    });
    expect(ctx.items).toEqual([
      { name: 'Rekey', sku: 'RK', quantity: 2, unitPrice: 50, amount: 100, taxable: true },
    ]);
    expect(ctx.totals).toMatchObject({ subtotal: 100, tax: 6.35, total: 106.35, taxRateName: 'CT Sales', taxRatePercent: 6.35 });
    expect(ctx.assets).toEqual({
      'asset-1': 'data:image/png;base64,asset-1',
      'asset-2': 'data:image/png;base64,asset-2',
    });
    expect(ctx.currency).toBe('USD');
    expect(ctx.today).toBe('Sep 16, 2026');
  });

  it('uses the deal client-name override and survives CRM being down', async () => {
    crm.getContact.mockRejectedValueOnce(new Error('crm down'));
    const view = billingView({ clientName: { firstName: 'Override', lastName: 'Name' } });
    const ctx = await builder.build('invoice', invoiceView(), view, template({ body: [], footer: [] }));
    expect(ctx.client.fullName).toBe('Override Name');
    expect(ctx.assets).toEqual({});
  });

  it('builds an estimate document with its name and totals from its own items', async () => {
    const est = {
      id: 'e1',
      number: 'K4T9ZW-1',
      name: 'Good',
      status: 'pending',
      estimateDate: '2026-09-15',
      taxRateName: 'CT',
      taxRatePercent: 10,
      discount: { type: 'amount', value: 10 },
      items: [
        { lineId: 'l1', productId: 'p', name: 'Lock', sku: 'L', quantity: 1, priceClient: 110, taxable: true, position: 0 },
      ],
    } as unknown as EstimateWithItems;
    const ctx = await builder.build('estimate', est, billingView({}, [dealProduct()]), template({ kind: 'estimate', body: [], footer: [] }));
    expect(ctx.document).toMatchObject({ number: 'K4T9ZW-1', name: 'Good', date: 'Sep 15, 2026', status: 'pending' });
    expect(ctx.document.dueDate).toBeUndefined();
    expect(ctx.totals).toMatchObject({ subtotal: 110, discount: 10, tax: 10, total: 110 });
  });
});

describe('DocumentsService', () => {
  const s3 = {
    objectExists: jest.fn(),
    putObject: jest.fn(async () => undefined),
    getPresignedDownloadUrl: jest.fn(async () => 'https://s3/signed'),
  };
  const pdf = { render: jest.fn(async () => Buffer.from('%PDF')) };
  const templates = { resolveForDocument: jest.fn(async () => template()) };
  const ctx = { document: { number: 'K4T9ZW' } };
  const builder = { build: jest.fn(async () => ctx) };
  let service: DocumentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DocumentsService(templates as never, builder as never, pdf as never, s3 as never);
  });

  const source = { kind: 'invoice' as const, doc: invoiceView(), view: billingView() };

  it('resolves the template from the document and job', async () => {
    await service.html(source);
    expect(templates.resolveForDocument).toHaveBeenCalledWith({
      kind: 'invoice',
      templateId: undefined,
      jobTypeId: 'jt-1',
      serviceAreaId: 'sa-1',
    });
  });

  it('renders HTML in screen mode', async () => {
    await expect(service.html(source)).resolves.toEqual({ html: '<html>K4T9ZW:screen</html>' });
  });

  it('renders + uploads a PDF once, keyed by template version and context', async () => {
    s3.objectExists.mockResolvedValueOnce(false);
    const res = await service.pdf(source, { download: true, filename: 'Invoice-K4T9ZW.pdf' });
    const hash = pdfCacheHash(template(), ctx as never);
    const key = `billing/pdfs/deal-1/${hash}.pdf`;
    expect(renderer.renderDocumentHtml).toHaveBeenCalledWith(expect.anything(), ctx, { mode: 'pdf' });
    expect(pdf.render).toHaveBeenCalledWith('<html>K4T9ZW:pdf</html>', 'invoice');
    expect(s3.putObject).toHaveBeenCalledWith(key, Buffer.from('%PDF'), {
      contentType: 'application/pdf',
      kmsKeyId: expect.any(String),
    });
    expect(s3.getPresignedDownloadUrl).toHaveBeenCalledWith(key, {
      expiresIn: 300,
      contentDisposition: 'attachment; filename="Invoice-K4T9ZW.pdf"',
    });
    expect(res).toEqual({ url: 'https://s3/signed' });
  });

  it('serves a cached PDF without launching the browser', async () => {
    s3.objectExists.mockResolvedValueOnce(true);
    await service.pdf(source, { download: false, filename: 'Invoice-K4T9ZW.pdf' });
    expect(pdf.render).not.toHaveBeenCalled();
    expect(s3.putObject).not.toHaveBeenCalled();
    expect(s3.getPresignedDownloadUrl).toHaveBeenCalledWith(expect.any(String), {
      expiresIn: 300,
      contentDisposition: 'inline; filename="Invoice-K4T9ZW.pdf"',
    });
  });

  it('renders ad-hoc content for the editor preview (sample or real context)', async () => {
    const out = await service.renderContent('invoice', { page: {} } as never, ctx as never, 'html');
    expect(out).toEqual({ html: '<html>K4T9ZW:screen</html>' });
  });
});

describe('resolveChromeExecutable', () => {
  it('prefers PUPPETEER_EXECUTABLE_PATH, then the first existing known path', () => {
    const exists = (p: string) => p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    expect(resolveChromeExecutable({ PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium-browser' }, () => true)).toBe(
      '/usr/bin/chromium-browser',
    );
    expect(resolveChromeExecutable({}, exists)).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });

  it('throws a 503 when there is no browser', () => {
    expect(() => resolveChromeExecutable({}, () => false)).toThrow(ServiceUnavailableException);
    expect(() => resolveChromeExecutable({ PUPPETEER_EXECUTABLE_PATH: '/nope' }, () => false)).toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('AssetsService', () => {
  const s3 = {
    getPresignedUpload: jest.fn(async () => ({ url: 'https://s3/up', headers: { 'Content-Type': 'image/png' } })),
    getPresignedDownloadUrl: jest.fn(async () => 'https://s3/get'),
    getObjectBuffer: jest.fn(async () => ({ body: Buffer.from('img'), contentType: 'image/png' })),
  };
  const repo = { create: jest.fn(async () => undefined), get: jest.fn() };
  let service: AssetsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AssetsService(repo as never, s3 as never);
  });

  it('issues a KMS presigned upload for png/jpeg/webp up to 5 MB', async () => {
    const res = await service.requestUpload({ contentType: 'image/png', fileName: 'logo.png', size: 1024 }, user());
    expect(res).toEqual({ id: expect.any(String), uploadUrl: 'https://s3/up', headers: { 'Content-Type': 'image/png' } });
    expect(s3.getPresignedUpload).toHaveBeenCalledWith(`billing/assets/${res.id}`, {
      contentType: 'image/png',
      kmsKeyId: expect.any(String),
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: res.id, contentType: 'image/png', createdBy: 'u-1', fileName: 'logo.png' }),
    );
  });

  it('rejects svg and anything over 5 MB', async () => {
    await expect(service.requestUpload({ contentType: 'image/svg+xml' }, user())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.requestUpload({ contentType: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }, user()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('inlines an asset as a data URI and caches it', async () => {
    repo.get.mockResolvedValue({ id: 'a1', contentType: 'image/png' });
    await expect(service.getDataUri('a1')).resolves.toBe(`data:image/png;base64,${Buffer.from('img').toString('base64')}`);
    await service.getDataUri('a1');
    expect(s3.getObjectBuffer).toHaveBeenCalledTimes(1);
  });

  it('answers undefined for a missing asset', async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.getDataUri('gone')).resolves.toBeUndefined();
  });
});
