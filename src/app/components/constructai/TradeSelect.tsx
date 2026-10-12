// Trade picker used wherever a trade is chosen. Grouped, with the trades sites
// use most at the top. "Other" opens a box to type a trade that isn't listed;
// a value already saved that isn't in the list shows as that typed trade.

import { useState } from "react";
import { TRADES, TRADE_GROUPS, TRADE_NAMES } from "./roles";

export function TradeSelect({ value, onChange, className, placeholder = "Select a trade…", allowEmpty = true }: {
  value: string;
  onChange: (trade: string) => void;
  className?: string;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const custom = !!value && !TRADE_NAMES.includes(value);
  const [typing, setTyping] = useState(custom || value === "Other");
  const selectValue = typing ? "Other" : value;
  const cls = className || "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]";

  return (
    <div className="space-y-1.5 min-w-0">
      <select
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "Other") { setTyping(true); onChange(""); }
          else { setTyping(false); onChange(v); }
        }}
        className={cls}
      >
        {allowEmpty && <option value="">{placeholder}</option>}
        {TRADE_GROUPS.map((g) => (
          <optgroup key={g} label={g}>
            {TRADES.filter((t) => t.group === g).map((t) => <option key={t.name} value={t.name}>{t.name === "Other" ? "Other (type it)" : t.name}</option>)}
          </optgroup>
        ))}
      </select>
      {typing && (
        <input
          autoFocus
          value={custom ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type the trade, e.g. Swimming pools"
          className={cls.replace("px-2", "px-3")}
        />
      )}
    </div>
  );
}
