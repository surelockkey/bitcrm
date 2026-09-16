import type { RenderContext } from '../../../src/templates/render-context';

/** A context with every short-code input filled — each code must resolve from it. */
export function fullContext(): RenderContext {
  return {
    contact: {
      firstName: 'Jane',
      lastName: 'Doe',
      phones: ['+14045551234', '+14045550000'],
      emails: ['jane@example.com'],
      addresses: [{ street: '9 Elm St', city: 'Decatur', state: 'GA', zip: '30030' }],
      companyId: 'co1',
    },
    deal: {
      id: 'd1',
      dealNumber: 'K4T9ZW',
      scheduledDate: '2026-09-15',
      scheduledTimeSlot: '14:30-16:00',
      address: { street: '12 Main St', unit: 'Apt 3', city: 'Atlanta', state: 'GA', zip: '30301' },
      notes: 'Rekey front and back doors',
      assignedTechIds: ['u7'],
      jobTypeName: 'Lock change',
      jobSourceName: 'Google Ads',
      externalCompanyName: 'Roadside Partner LLC',
    },
    technician: { firstName: 'Mike', lastName: 'Smith', phone: '+14045559876' },
    company: { title: 'Acme Property Mgmt' },
    settings: {
      companyName: 'Sure Lock & Key',
      companyPhone: '+12034036303',
      companyEmail: 'office@example.com',
      confirmLinkBaseUrl: 'https://book.example.com/confirm',
      infoLinkBaseUrl: 'https://book.example.com/job/{{deal_id}}/info',
      defaultSenderNumber: '+15550001111',
    },
    values: { late_value: '15' },
    timezone: 'America/New_York',
  };
}
