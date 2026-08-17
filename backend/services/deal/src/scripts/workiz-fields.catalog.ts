import { randomUUID } from 'node:crypto';
import { type CustomFieldDefinition, type CustomFieldType } from '@bitcrm/types';

/**
 * The custom-field catalog migrated from Workiz, verbatim from its settings
 * screen: same names, groups, order and input types. Dropdown option lists
 * aren't visible on the screenshots, so they seed empty and get filled in
 * Settings → Custom Fields.
 */
export const WORKIZ_FIELDS: {
  name: string;
  group: string;
  type: CustomFieldType;
  searchable?: boolean;
  options?: string[];
}[] = [
  // Group: Extra Info (the dropdowns at the top of the New Job form)
  { name: 'Jobs Dispatch', group: 'Extra Info', type: 'dropdown', options: [] },
  { name: 'Dispatchers ID UA', group: 'Extra Info', type: 'dropdown', options: [] },
  { name: 'Dispatchers ID GE', group: 'Extra Info', type: 'dropdown', options: [] },
  // Group: Other Contact
  { name: 'Additional number', group: 'Other Contact', type: 'number' },
  { name: 'Additional number 2', group: 'Other Contact', type: 'number' },
  // Group: Dispatchers
  { name: 'Manager Note', group: 'Dispatchers', type: 'large_text' },
  { name: 'Searchable number', group: 'Dispatchers', type: 'text', searchable: true },
  { name: 'Searchable number 2', group: 'Dispatchers', type: 'text', searchable: true },
  // Group: Tech
  { name: 'Check Image Front', group: 'Tech', type: 'file' },
  { name: 'Check Image Back', group: 'Tech', type: 'file' },
  { name: 'Tech Parts cost', group: 'Tech', type: 'number' },
  { name: 'Company Parts cost', group: 'Tech', type: 'number' },
  { name: 'Parts Image', group: 'Tech', type: 'file' },
  { name: 'After Job Image', group: 'Tech', type: 'file' },
  { name: 'Before Job Image', group: 'Tech', type: 'file' },
  // Group: Platinum
  { name: 'WO File', group: 'Platinum', type: 'file' },
  { name: 'Vendor N', group: 'Platinum', type: 'text' },
  { name: 'C PO', group: 'Platinum', type: 'text' },
  { name: 'VPO', group: 'Platinum', type: 'text' },
  { name: 'WO SERVICE DESCRIPTION', group: 'Platinum', type: 'large_text' },
  { name: 'Picture Before After', group: 'Platinum', type: 'file' },
  { name: 'Work Order Link', group: 'Platinum', type: 'large_text' },
  // Group: Company
  { name: 'Choose Company', group: 'Company', type: 'dropdown', options: [] },
  // Group: Need To Order
  { name: 'Item to be ordered', group: 'Need To Order', type: 'text' },
  { name: 'Quantity', group: 'Need To Order', type: 'number' },
];

/**
 * Full definitions for the fields that still need creating, skipping names the
 * catalog already has (case-insensitive) so reruns are safe. Priority descends
 * with screenshot order inside each group ("higher sorts first").
 */
export function planWorkizSeed(existingNames: string[]): CustomFieldDefinition[] {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const now = new Date().toISOString();

  const perGroupLeft = new Map<string, number>();
  for (const f of WORKIZ_FIELDS) {
    perGroupLeft.set(f.group, (perGroupLeft.get(f.group) ?? 0) + 1);
  }

  const out: CustomFieldDefinition[] = [];
  const seen = new Map<string, number>();
  for (const f of WORKIZ_FIELDS) {
    // Priority: first field of a group gets the group's size, the last gets 1.
    const index = seen.get(f.group) ?? 0;
    seen.set(f.group, index + 1);
    if (taken.has(f.name.toLowerCase())) continue;
    out.push({
      id: randomUUID(),
      name: f.name,
      type: f.type,
      group: f.group,
      options: f.options ?? [],
      jobTypeIds: [],
      required: false,
      requiredToClose: false,
      searchable: f.searchable ?? false,
      priority: (perGroupLeft.get(f.group) ?? 1) - index,
      active: true,
      createdBy: 'workiz-seed',
      createdAt: now,
      updatedAt: now,
    });
  }
  return out;
}
