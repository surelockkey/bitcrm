import type { DocumentRenderContext, DocumentTemplateKind } from '@bitcrm/types';
import { calculateDocumentTotals, lineAmount } from '@bitcrm/types';

const SAMPLE_ITEMS = [
  {
    name: 'Rekey lock cylinder',
    description: 'Rekey existing cylinders to a new key, 2 keys included',
    sku: 'RK-CYL',
    quantity: 4,
    unitPrice: 35,
    taxable: true,
  },
  {
    name: 'Schlage B60N deadbolt',
    description: 'Grade 1 single-cylinder deadbolt, satin nickel',
    sku: 'SCH-B60N',
    quantity: 2,
    unitPrice: 89,
    taxable: true,
  },
  {
    name: 'Emergency service call',
    description: 'After-hours dispatch fee',
    sku: 'SVC-EMRG',
    quantity: 1,
    unitPrice: 125,
    taxable: false,
  },
  {
    name: 'Key duplication',
    description: 'Standard KW1/SC1 key copies',
    sku: 'KEY-DUP',
    quantity: 6,
    unitPrice: 4.5,
    taxable: true,
  },
];

/** Realistic locksmith sample data for editor previews (fresh object every call). */
export function sampleRenderContext(kind: DocumentTemplateKind): DocumentRenderContext {
  const isInvoice = kind === 'invoice';
  const isEstimate = kind === 'estimate';
  const items = SAMPLE_ITEMS.map((i) => ({ ...i, amount: lineAmount({ quantity: i.quantity, priceClient: i.unitPrice }) }));
  const totals = calculateDocumentTotals({
    lines: items.map((i) => ({ quantity: i.quantity, priceClient: i.unitPrice, taxable: i.taxable })),
    taxRatePercent: 6.35,
    discount: { type: 'amount', value: 25 },
    amountPaid: isInvoice ? 100 : 0,
  });

  return {
    kind,
    business: {
      name: 'SureLock Key Services',
      legalName: 'SureLock Key Services LLC',
      phone: '(860) 555-0142',
      email: 'office@surelockkey.com',
      website: 'www.surelockkey.com',
      licenseNumber: 'LCK.0001234',
      address: '120 Main St, Hartford, CT 06103',
    },
    client: {
      firstName: 'Emily',
      lastName: 'Carter',
      fullName: 'Emily Carter',
      companyName: 'Carter Dental Group',
      email: 'emily.carter@example.com',
      phone: '(860) 555-0199',
      address: '45 Oak Ave, West Hartford, CT 06107',
      billingAddress: 'PO Box 311, West Hartford, CT 06127',
    },
    job: {
      number: '1042',
      address: '45 Oak Ave, West Hartford, CT 06107',
      jobType: 'Rekey & lock upgrade',
      serviceArea: 'Hartford County',
      scheduledDate: 'Sep 12, 2026 10:00 AM',
      technicians: 'Mike Rivera',
      poNumber: 'PO-7781',
      customFields: { gateCode: '4471' },
    },
    document: {
      number: isEstimate ? '1042-1' : '1042',
      date: 'Sep 12, 2026',
      dueDate: isInvoice ? 'Sep 26, 2026' : undefined,
      paymentTerms: isInvoice ? 'Net 14' : undefined,
      status: isInvoice ? 'Due' : isEstimate ? 'Pending' : undefined,
      name: isEstimate ? 'Option A – High-security upgrade' : kind === 'custom' ? 'Service agreement' : undefined,
      notes: 'Gate code 4471. Please call on arrival.\nAll hardware carries a 1-year warranty.',
    },
    items,
    totals: {
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxRateName: 'CT Sales Tax',
      taxRatePercent: totals.taxRatePercent,
      tax: totals.tax,
      total: totals.total,
      amountPaid: totals.amountPaid,
      balanceDue: totals.balanceDue,
    },
    assets: {},
    currency: 'USD',
    today: 'Sep 16, 2026',
  };
}
