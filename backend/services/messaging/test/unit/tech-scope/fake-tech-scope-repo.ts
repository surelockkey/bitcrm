import { type TechScopeRow, type TechScopeState } from '../../../src/tech-scope/tech-scope.repository';

/** `TechScopeRepository` in memory, with the same write guards as DynamoDB's conditions. */
export class FakeTechScopeRepo {
  rows = new Map<string, TechScopeRow>();
  state: TechScopeState | null = null;

  get = jest.fn(async (userId: string) => clone(this.rows.get(userId) ?? null));

  put = jest.fn(async (row: TechScopeRow, opts: { expectComputedAt?: string } = {}) => {
    const current = this.rows.get(row.userId);
    if (opts.expectComputedAt !== undefined) {
      if (!current || current.computedAt !== opts.expectComputedAt) return false;
    } else if (current && current.computedAt > row.computedAt) {
      return false;
    }
    this.rows.set(row.userId, clone(row)!);
    return true;
  });

  delete = jest.fn(async (userId: string) => {
    this.rows.delete(userId);
  });

  listAll = jest.fn(async () => [...this.rows.values()].map((r) => clone(r)!));

  listByContact = jest.fn(async (contactId: string) =>
    [...this.rows.values()].filter((r) => r.deals.some((d) => d.contactId === contactId)).map((r) => clone(r)!),
  );

  getState = jest.fn(async () => this.state);

  putState = jest.fn(async (state: TechScopeState) => {
    this.state = state;
  });
}

const clone = <T>(v: T): T => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));
