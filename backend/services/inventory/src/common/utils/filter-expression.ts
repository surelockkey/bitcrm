/**
 * A DynamoDB FilterExpression assembled from optional report filters.
 *
 * The Workiz report filters are multi-selects (TECHS, LOCATIONS, CATEGORY,
 * BRAND), so each filter takes a list: one value stays the plain `attr = :p`
 * the single-value filters always wrote, several become `attr IN (:p0, :p1)`
 * (DynamoDB allows up to 100 operands; the DTOs cap a list at 50). An empty
 * or absent list is no filter at all.
 */
export interface FilterParts {
  expression?: string;
  names?: Record<string, string>;
  values: Record<string, unknown>;
}

/** A query parameter that may arrive once (a string) or repeated (an array). */
export function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter((v) => typeof v === 'string' && v !== '');
}

export class FilterBuilder {
  private readonly parts: string[] = [];
  private readonly names: Record<string, string> = {};
  private readonly values: Record<string, unknown> = {};

  /** `attr` equals one of `values`; `stem` names the placeholders (`:stem`, `:stem0`…). */
  equalsAny(attr: string, values: string | string[] | undefined, stem: string = attr): this {
    const list = asList(values);
    if (list.length === 0) return this;
    this.parts.push(this.equalsClause(attr, this.placeholders(stem, list)));
    return this;
  }

  /** Either of two attributes equals one of `values` — a location on either side of a move. */
  eitherEqualsAny(attrs: [string, string], values: string | string[] | undefined, stem: string): this {
    const list = asList(values);
    if (list.length === 0) return this;
    const placeholders = this.placeholders(stem, list);
    this.parts.push(`(${attrs.map((attr) => this.equalsClause(attr, placeholders)).join(' OR ')})`);
    return this;
  }

  /** A list/set attribute holds one of `values`. */
  containsAny(attr: string, values: string | string[] | undefined, stem: string = attr): this {
    const list = asList(values);
    if (list.length === 0) return this;
    const clauses = this.placeholders(stem, list).map((p) => `contains(${attr}, ${p})`);
    this.parts.push(clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`);
    return this;
  }

  /** A clause written by hand, with its own placeholders. */
  raw(expression: string, values: Record<string, unknown> = {}, names: Record<string, string> = {}): this {
    this.parts.push(expression);
    Object.assign(this.values, values);
    Object.assign(this.names, names);
    return this;
  }

  build(): FilterParts {
    if (this.parts.length === 0) return { values: {} };
    return {
      expression: this.parts.join(' AND '),
      names: Object.keys(this.names).length > 0 ? { ...this.names } : undefined,
      values: { ...this.values },
    };
  }

  private placeholders(stem: string, list: string[]): string[] {
    if (list.length === 1) {
      this.values[`:${stem}`] = list[0];
      return [`:${stem}`];
    }
    return list.map((value, index) => {
      this.values[`:${stem}${index}`] = value;
      return `:${stem}${index}`;
    });
  }

  private equalsClause(attr: string, placeholders: string[]): string {
    return placeholders.length === 1 ? `${attr} = ${placeholders[0]}` : `${attr} IN (${placeholders.join(', ')})`;
  }
}
