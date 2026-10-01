import { Logger } from '@nestjs/common';
import type { CrmClient } from './crm.client';

/** How a billing report shows its client: the name, and under it an email or a phone. */
export interface ReportClient {
  name?: string;
  email?: string;
  phone?: string;
}

const CHUNK = 100;
const PARALLEL = 4;
const logger = new Logger('ReportClients');

/**
 * Names (and, when the caller may see them, emails and phones) for the
 * clients on a report, by contact id.
 *
 * Read AS THE CALLER (`contactsAs`, the permission-guarded route), so the
 * report never shows more of a contact than the contact screen would. When
 * that route refuses or fails — a role without `contacts.view` still reads
 * reports — it falls back to the internal names-only route: the name, never
 * a number or an address.
 */
export async function reportClients(
  crm: Pick<CrmClient, 'contactsAs' | 'contactNamesByIds'>,
  ids: Iterable<string>,
  authorization?: string,
): Promise<Map<string, ReportClient>> {
  const unique = [...new Set([...ids].filter(Boolean))];
  const out = new Map<string, ReportClient>();
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += CHUNK) chunks.push(unique.slice(i, i + CHUNK));

  let asCaller = !!authorization;
  const one = async (chunk: string[]) => {
    if (asCaller) {
      try {
        for (const c of await crm.contactsAs(chunk, authorization)) {
          out.set(c.id, {
            name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || undefined,
            ...(c.emails?.[0] && { email: c.emails[0] }),
            ...(c.phones?.[0] && { phone: c.phones[0] }),
          });
        }
        return;
      } catch (err) {
        // A refusal is about the caller, not the chunk: stop asking.
        asCaller = false;
        logger.warn(`client details unavailable as the caller (${(err as Error).message}); names only`);
      }
    }
    try {
      for (const c of await crm.contactNamesByIds(chunk)) {
        out.set(c.id, { name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || undefined });
      }
    } catch (err) {
      logger.warn(`client names unavailable: ${(err as Error).message}`);
    }
  };

  for (let i = 0; i < chunks.length; i += PARALLEL) {
    await Promise.all(chunks.slice(i, i + PARALLEL).map(one));
  }
  return out;
}
