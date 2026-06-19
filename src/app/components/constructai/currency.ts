export type CurrencyCode = "KES" | "USD" | "EUR" | "GBP" | "NGN";

export interface Currency {
  code: CurrencyCode;
  symbol: string;
  name: string;
  locale: string;
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  KES: { code: "KES", symbol: "KSh", name: "Kenyan Shilling", locale: "en-KE" },
  USD: { code: "USD", symbol: "$", name: "US Dollar", locale: "en-US" },
  EUR: { code: "EUR", symbol: "€", name: "Euro", locale: "de-DE" },
  GBP: { code: "GBP", symbol: "£", name: "British Pound", locale: "en-GB" },
  NGN: { code: "NGN", symbol: "₦", name: "Nigerian Naira", locale: "en-NG" },
};

// Conversion rates (example rates - in production, these would come from an API)
const RATES: Record<CurrencyCode, number> = {
  KES: 1,
  USD: 0.0077,    // 1 KES = 0.0077 USD (~130 KES per USD)
  EUR: 0.0071,    // 1 KES = 0.0071 EUR
  GBP: 0.0060,    // 1 KES = 0.0060 GBP
  NGN: 11.8,      // 1 KES = 11.8 NGN
};

// Base amounts are stored in KES (smallest unit)
export function formatCurrency(amountKES: number, currency: CurrencyCode = "KES"): string {
  const curr = CURRENCIES[currency];
  const rate = RATES[currency];
  const converted = amountKES * rate;
  
  // Format based on currency
  if (currency === "KES" || currency === "NGN") {
    // No decimals for KES/NGN typically
    return `${curr.symbol}${Math.round(converted).toLocaleString(curr.locale)}`;
  }
  
  return `${curr.symbol}${converted.toLocaleString(curr.locale, { 
    minimumFractionDigits: 0, 
    maximumFractionDigits: 2 
  })}`;
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

// Detect currency based on location/timezone
export function detectCurrency(): CurrencyCode {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    // Kenya timezones
    if (timezone.includes("Nairobi") || timezone.includes("Mombasa")) {
      return "KES";
    }
    
    // Nigeria timezones
    if (timezone.includes("Lagos") || timezone.includes("Abuja")) {
      return "NGN";
    }
    
    // European timezones
    if (timezone.includes("London")) return "GBP";
    if (timezone.includes("Berlin") || timezone.includes("Paris") || timezone.includes("Madrid")) return "EUR";
    
    // Default to KES (Kenyan Shillings) as requested
    return "KES";
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
