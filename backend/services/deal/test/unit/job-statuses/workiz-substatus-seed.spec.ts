import { JobSuperStatus } from '@bitcrm/types';
import {
  WORKIZ_SUBSTATUSES,
  planWorkizSubStatusSeed,
} from 'src/scripts/workiz-substatuses.catalog';

describe('Workiz sub-status seed catalog', () => {
  const names = (group: JobSuperStatus) =>
    WORKIZ_SUBSTATUSES.filter((s) => s.group === group).map((s) => s.name);

  it('carries every sub-status from the old CRM, grouped as there', () => {
    expect(names(JobSuperStatus.CANCELED)).toEqual([
      'Will Call Back',
      'Cant Do - tech said cant do',
      'Customer Resolved',
      'Went with a different company',
      'CANCELED - LEAD',
      'No Tech',
      'NOT RELEVANT - job not served',
      'High Price',
      'Out of area',
      'Because of the Office',
    ]);
    expect(names(JobSuperStatus.IN_PROGRESS)).toEqual([
      'In progress',
      'Job Done',
      'Job Accepted',
      'Job Issues',
      'Platinum',
    ]);
    expect(names(JobSuperStatus.PENDING)).toEqual([
      'NO ANSWER',
      'QUOTE - FOLLOW UP',
      'WILL CALL BACK - FOLLOW-UP',
      'CANCELED CHECK',
      'Waiting for parts',
      'WAITING FOR APPROVAL',
      'WAITING FOR AN ESTIMATE',
      'Platinum updates',
    ]);
    expect(names(JobSuperStatus.DONE_PENDING_APPROVAL)).toEqual([
      'BILLING',
      'CHEQUE',
      'TECHNICAL ERROR',
      'SUB BILLING',
    ]);
    expect(WORKIZ_SUBSTATUSES).toHaveLength(27);
  });

  it('plans only the sub-statuses that do not already exist (case-insensitive)', () => {
    const plan = planWorkizSubStatusSeed(['high price', 'BILLING', 'Unrelated']);

    const planned = plan.map((s) => s.name);
    expect(planned).not.toContain('High Price');
    expect(planned).not.toContain('BILLING');
    expect(planned).toContain('No Tech');
    expect(plan).toHaveLength(25);
  });

  it('orders sub-statuses inside a group by descending priority (list order)', () => {
    const canceled = planWorkizSubStatusSeed([]).filter(
      (s) => s.group === JobSuperStatus.CANCELED,
    );
    const priorities = canceled.map((s) => s.priority);
    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it('builds complete active definitions', () => {
    const one = planWorkizSubStatusSeed([]).find((s) => s.name === 'High Price')!;
    expect(one.active).toBe(true);
    expect(one.id).toBeTruthy();
    expect(one.color).toBeTruthy();
    expect(one.createdBy).toBe('workiz-seed');
  });
});
