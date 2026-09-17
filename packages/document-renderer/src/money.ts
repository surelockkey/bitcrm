const formatters = new Map<string, Intl.NumberFormat | null>();

function formatterFor(currency: string): Intl.NumberFormat | null {
  if (!formatters.has(currency)) {
    let f: Intl.NumberFormat | null = null;
    try {
      f = new Intl.NumberFormat('en-US', { style: 'currency', currency });
    } catch {
      f = null;
    }
    formatters.set(currency, f);
  }
  return formatters.get(currency) ?? null;
}

/** `formatMoney(1234.5)` → `$1,234.50`. Invalid currency codes degrade to a plain 2-decimal number. */
export function formatMoney(n: number, currency = 'USD'): string {
  const value = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  const f = formatterFor(typeof currency === 'string' && currency ? currency.toUpperCase() : 'USD');
  if (f) return f.format(value);
  return value.toFixed(2);
}

/** `6.35` → `6.35%`, `7` → `7%`. */
export function formatPercent(n: number): string {
  const value = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return `${Math.round(value * 1000) / 1000}%`;
}
