import { http } from "@/lib/api/http";

export interface OwnedNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl?: string | null;
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality?: string | null;
  region?: string | null;
  /** Monthly recurring price, e.g. "1.15". */
  price?: string;
  /** Currency, e.g. "USD". */
  priceUnit?: string;
}

/** "1.15" + "USD" → "$1.15/mo" (falls back to "1.15 USD/mo"). */
export function formatMonthlyPrice(
  price?: string,
  unit?: string,
): string | null {
  if (!price) return null;
  const n = Number(price);
  const amount = Number.isFinite(n) ? n.toFixed(2) : price;
  if (unit === "USD") return `$${amount}/mo`;
  return `${amount} ${unit ?? ""}/mo`.trim();
}

export interface AvailableSearch {
  country?: string;
  areaCode?: string;
  contains?: string;
}

/** The account's phone numbers (any authenticated user — powers the dialer). */
export const listNumbers = (): Promise<OwnedNumber[]> =>
  http.get<OwnedNumber[]>("/telephony/numbers");

/** Search purchasable numbers (settings.edit). */
export const searchAvailableNumbers = (
  params: AvailableSearch,
): Promise<AvailableNumber[]> => {
  const qs = new URLSearchParams();
  if (params.country) qs.set("country", params.country);
  if (params.areaCode) qs.set("areaCode", params.areaCode);
  if (params.contains) qs.set("contains", params.contains);
  return http.get<AvailableNumber[]>(
    `/telephony/numbers/available?${qs.toString()}`,
  );
};

/** Buy a number (settings.edit). */
export const buyNumber = (phoneNumber: string): Promise<OwnedNumber> =>
  http.post<OwnedNumber>("/telephony/numbers", { phoneNumber });

/** Release a number (settings.edit). */
export const releaseNumber = (
  sid: string,
): Promise<{ sid: string; released: boolean }> =>
  http.delete<{ sid: string; released: boolean }>(`/telephony/numbers/${sid}`);
