// Exactly two currencies are supported: Kenyan Shillings and US Dollars.
//
// EUR, GBP and NGN used to be offered here and in the exposure picker. Every rate
// was a hardcoded guess, none of the three matched a market this product sells
// into, and each extra symbol was one more way for a figure to be displayed in a
// unit nobody intended. Adding a currency means adding a real rate source, not a
// line in this table.
export type CurrencyCode = "KES" | "USD";

export interface Currency {
  code: CurrencyCode;
  symbol: string;
  name: string;
  locale: string;
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  KES: { code: "KES", symbol: "KSh", name: "Kenyan Shilling", locale: "en-KE" },
  USD: { code: "USD", symbol: "$", name: "US Dollar", locale: "en-US" },
};

// Every supported currency, for building pickers. Iterate this rather than
// hardcoding a list, so a picker cannot drift out of step with what is supported.
export const CURRENCY_CODES: CurrencyCode[] = ["KES", "USD"];

// Conversion rates (example rates - in production, these would come from an API)
const RATES: Record<CurrencyCode, number> = {
  KES: 1,
  USD: 0.0077,    // 1 KES = 0.0077 USD (~130 KES per USD)
};

// Base amounts are stored in KES (smallest unit)
export function formatCurrency(amountKES: number, currency: CurrencyCode = "KES"): string {
  const curr = CURRENCIES[currency];
  const rate = RATES[currency];
  const converted = amountKES * rate;

  // Shillings are not shown with cents.
  if (currency === "KES") {
    return `${curr.symbol}${Math.round(converted).toLocaleString(curr.locale)}`;
  }

  return `${curr.symbol}${converted.toLocaleString(curr.locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`;
}

// Shillings per dollar, derived from the rate table above rather than written
// out again. Change-order costs are stored in USD while everything else is
// measured in KES, and ChangeOrders.tsx / ChangeOrderDetail.tsx each used to
// hardcode their own `USD_TO_KES = 130`. That disagreed with RATES.USD (0.0077,
// i.e. ~129.87), so converting USD -> KES -> USD did not round-trip and a
// $2,000 order redisplayed as $2,002 in a USD workspace.
export const USD_TO_KES = 1 / RATES.USD;

// Convert a KES base amount into the units of `currency`. Use this for INPUT
// fields, where the user types a bare number and we need the value rather than
// a formatted string — formatCurrency's output cannot be fed back into an
// <input type="number">.
export function fromKES(amountKES: number, currency: CurrencyCode = "KES"): number {
  return amountKES * RATES[currency];
}

// Inverse of fromKES: take an amount the user typed in `currency` and express it
// in the KES base every stored figure is measured against.
export function toKES(amount: number, currency: CurrencyCode = "KES"): number {
  return amount / RATES[currency];
}

// Round to the precision that currency is actually quoted in: whole shillings,
// dollars-and-cents. Use this when putting a converted figure INTO an input, so a
// shilling field never shows "259740.26" and a dollar field never loses its cents.
export function roundForCurrency(amount: number, currency: CurrencyCode = "KES"): number {
  return currency === "KES" ? Math.round(amount) : Math.round(amount * 100) / 100;
}

// Format large numbers (e.g., millions)
export function formatCompactCurrency(amountKES: number, currency: CurrencyCode = "KES"): string {
  const curr = CURRENCIES[currency];
  const rate = RATES[currency];
  const converted = amountKES * rate;
  
  if (converted >= 1_000_000) {
    const millions = converted / 1_000_000;
    return `${curr.symbol}${millions.toFixed(1)}M`;
  }
  if (converted >= 1_000) {
    const thousands = converted / 1_000;
    return `${curr.symbol}${thousands.toFixed(1)}K`;
  }
  
  return formatCurrency(amountKES, currency);
}

// Pick a sensible starting currency from the browser's timezone. Only KES and USD
// exist, so this is a two-way choice: East Africa gets shillings, everywhere else
// starts on dollars. The user can switch at any time.
export function detectCurrency(): CurrencyCode {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (/Nairobi|Mombasa|Kampala|Dar_es_Salaam|Kigali/i.test(timezone)) return "KES";
    return "USD";
  } catch {
    return "KES";
  }
}

// Parse amount string (removes currency symbols and commas)
export function parseAmount(amountStr: string): number {
  const cleaned = amountStr
    .replace(/[^\d.-]/g, "")
    .replace(/,/g, "");
  return parseFloat(cleaned) || 0;
}
