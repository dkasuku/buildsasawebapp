// Shown instead of a Business-only module for companies on Starter.
import { Lock, CheckCircle2 } from "lucide-react";

const NAMES: Record<string, string> = { financials: "Financials", commitments: "Commitments", equipment: "Inventory & equipment", subcontractors: "Subcontractors", reports: "Reports" };

export function PlanUpgrade({ view, onUpgrade }: { view: string; onUpgrade: () => void }) {
  return (
    <div className="px-4 sm:px-7 py-10 flex justify-center">
      <div className="max-w-md w-full rounded-2xl border border-[#222A35] bg-[#11161D] p-7 text-center">
        <div className="w-12 h-12 rounded-xl bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 flex items-center justify-center mx-auto"><Lock className="w-5 h-5 text-[#FF6B1A]" /></div>
        <div className="text-[18px] text-white font-display mt-4">{NAMES[view] || "This feature"} is on the Business plan</div>
        <p className="text-[12.5px] text-[#8A95A5] mt-2">You're on Starter. Business adds the money and resources side of your projects:</p>
        <ul className="text-left text-[12.5px] text-[#C2CAD6] space-y-1.5 mt-4 inline-block">
          {["Financials, cash flow and budget vs actual", "Bills of quantities and payment certificates", "Commitments, retention and subcontractor payments", "Inventory and equipment", "Reports and scheduled reports", "10 team members included"].map((f) => (
            <li key={f} className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0 mt-0.5" />{f}</li>
          ))}
        </ul>
        <div><button onClick={onUpgrade} className="mt-5 h-10 px-5 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[13px]">Upgrade to Business</button></div>
      </div>
    </div>
  );
}
