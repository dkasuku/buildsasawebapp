import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { type CurrencyCode, detectCurrency, CURRENCIES } from "./currency";

interface CurrencyContextType {
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  currencies: typeof CURRENCIES;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<CurrencyCode>("KES");

  // Load saved currency preference on mount
  useEffect(() => {
    const saved = localStorage.getItem("constructai-currency") as CurrencyCode | null;
    if (saved && CURRENCIES[saved]) {
      setCurrencyState(saved);
    } else {
      // Try to detect from timezone
      const detected = detectCurrency();
      setCurrencyState(detected);
      localStorage.setItem("constructai-currency", detected);
    }
  }, []);

  const setCurrency = (c: CurrencyCode) => {
    setCurrencyState(c);
    localStorage.setItem("constructai-currency", c);
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, currencies: CURRENCIES }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context;
}
