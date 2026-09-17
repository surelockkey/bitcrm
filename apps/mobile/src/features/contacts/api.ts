import { http } from '../../lib/api/http';
import type { Contact } from '../jobs/types';

/**
 * The job's client. A technician's role carries `contacts.view_numbers`
 * (system-roles.ts:216), so `phones` comes back unmasked — which is only used
 * to know whether there is a number to call, never to dial one directly: the
 * call goes through the telephony bridge.
 */
export const getContact = (id: string): Promise<Contact> =>
  http.get<Contact>(`/crm/contacts/${id}`);
