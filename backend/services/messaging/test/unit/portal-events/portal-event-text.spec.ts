import { portalEventText } from '../../../src/outbound/portal-event-text';

/** The lines Workiz writes into a client's thread when they act on the portal. */
describe('portalEventText', () => {
  const doc = (kind: 'invoice' | 'estimate', number: string) => ({ kind, id: 'x', number });

  it('a view names the document only, as Workiz does', () => {
    expect(portalEventText({ event: 'viewed', document: doc('estimate', 'K4T9ZW-1') }, 'Jane Client')).toBe('Viewed estimate #K4T9ZW-1');
    expect(portalEventText({ event: 'viewed', document: doc('invoice', 'O8E9NQ') }, 'Jane Client')).toBe('Viewed invoice #O8E9NQ');
  });

  it('a signature, a decline and a payment say who did it', () => {
    expect(portalEventText({ event: 'signed', document: doc('invoice', 'O8E9NQ') }, 'Josh Wilenski')).toBe('Josh Wilenski signed Invoice #O8E9NQ');
    expect(portalEventText({ event: 'signed', document: doc('estimate', 'WL020Z-1') }, 'Kybrieo Huertas')).toBe('Kybrieo Huertas signed estimate #WL020Z-1');
    expect(portalEventText({ event: 'declined', document: doc('estimate', 'WL020Z-2') }, 'Jane Client')).toBe('Jane Client declined estimate #WL020Z-2');
    expect(portalEventText({ event: 'payment', document: doc('invoice', 'Y5HAQY'), amount: 120.5 }, 'Evo Door')).toBe(
      'Evo Door submitted payment for invoice #Y5HAQY ($120.50)',
    );
    expect(portalEventText({ event: 'payment', document: doc('estimate', 'AB12CD-1'), amount: 1000 }, 'Jane Client')).toBe(
      'Jane Client submitted a deposit for estimate #AB12CD-1 ($1,000.00)',
    );
  });

  it('says "The client" when nobody is known', () => {
    expect(portalEventText({ event: 'declined', document: doc('estimate', 'E-1') }, undefined)).toBe('The client declined estimate #E-1');
  });
});
