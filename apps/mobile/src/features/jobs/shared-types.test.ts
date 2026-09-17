import {
  JobSuperStatus as CrmJobSuperStatus,
  SUPER_STATUS_ORDER,
  type Deal as CrmDeal,
} from '@bitcrm/types';
import { statusLabel, statusTone } from './lib';
import { JobSuperStatus, type Deal } from './types';

/**
 * The seam the app now hangs on.
 *
 * `@bitcrm/types` is a `file:` dependency resolved out of the package's built
 * `dist`, from a node_modules tree two directories up. Nothing else in the
 * suite would notice if that link broke — every other test imports through
 * `./types` and would simply see `undefined` where an enum member should be.
 * So the import below is deliberately direct: a missing dist, a Metro config
 * that stops watching the repo root, or a workspace change that drops the
 * link fails here rather than at a technician's first tap.
 */
describe('@bitcrm/types across the file: link', () => {
  it('resolves the shared package at runtime, not only at compile time', () => {
    expect(CrmJobSuperStatus.IN_PROGRESS).toBe('in_progress');
    expect(SUPER_STATUS_ORDER).toHaveLength(6);
  });

  it('re-exports the server enum itself rather than a copy of it', () => {
    expect(JobSuperStatus).toBe(CrmJobSuperStatus);
  });

  it('has a chip for every super-status the server can send', () => {
    for (const status of SUPER_STATUS_ORDER) {
      // statusLabel echoes an unrecognised status back verbatim, so a label
      // that differs from the raw value is proof the phone knows this one.
      expect(statusLabel(status)).not.toBe(status);
    }
    expect(statusTone(CrmJobSuperStatus.CANCELED)).toBe('canceled');
  });

  /**
   * Compile-time rather than runtime: a job exactly as `deals.repository.ts`
   * builds it has to satisfy the phone's narrowed view. Rename or retype a
   * field on the server and this line stops compiling — which is the whole
   * reason this app stopped keeping its own copy of `Deal`.
   */
  it('takes a job exactly as the server declares it', () => {
    const asPhoneDeal = (deal: CrmDeal): Deal => deal;
    expect(asPhoneDeal).toBeInstanceOf(Function);
  });
});
