// Cost of construction: an indicative budget for a building in Kenya, from its
// size, type, finish and location. For a first figure in front of a client, a
// payment plan by stage, and a starting point for the AI to write the quote.
import { useMemo, useState } from "react";
import { Calculator, Copy, MessageCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  BUILDING_TYPES, CONTINGENCIES, DISCLAIMER, FINISH_RATES, LOCATIONS, RATES_UPDATED, SITE_CONDITIONS, estimateCost,
  type BuildingKey, type FinishKey, type LocationKey, type SiteKey,
} from "./costEstimate";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const short = (n: number) => (n >= 1e6 ? `KES ${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : kes(n));
// Typical built-up area by bedrooms, to fill the size for someone who doesn't know it.
const BEDROOMS: [string, number][] = [["1 bedroom", 50], ["2 bedrooms", 80], ["3 bedrooms", 120], ["4 bedrooms", 180], ["5 bedrooms", 250]];

export function CostEstimator({ onAsk }: { onAsk: (text: string) => void }) {
  const [buildingType, setType] = useState<BuildingKey>("residential");
  const [location, setLocation] = useState<LocationKey>("nairobi");
  const [finish, setFinish] = useState<FinishKey>("standard");
  const [area, setArea] = useState("120");
  const [floors, setFloors] = useState(1);
  const [site, setSite] = useState<SiteKey>("normal");
  const [fees, setFees] = useState(true);
  const [permits, setPermits] = useState(true);
  const [contingency, setContingency] = useState(0.1);
  const areaSqm = Math.max(0, Number(String(area).replace(/[^\d.]/g, "")) || 0);
  const r = useMemo(() => estimateCost({ buildingType, location, finish, areaSqm, floors, site, fees, permits, contingency }),
    [buildingType, location, finish, areaSqm, floors, site, fees, permits, contingency]);

  const what = `${BUILDING_TYPES[buildingType].label.toLowerCase()}, ${areaSqm} m², ${floors} floor${floors === 1 ? "" : "s"}, ${FINISH_RATES[finish].label.toLowerCase()} finish, ${LOCATIONS[location].label}`;
  const summary = [
    `Indicative cost: ${what}`,
    `Likely total: ${kes(r.mid)} (range ${short(r.low)} to ${short(r.high)})`,
    `About ${kes(r.perSqm)} per m²`,
    "",
    ...r.stages.map((s) => `${s.stage}: ${kes(s.amount)}`),
    r.breakdown.fees ? `Professional fees: ${kes(r.breakdown.fees)}` : "",
    r.breakdown.permits ? `Approvals and permits: ${kes(r.breakdown.permits)}` : "",
    r.breakdown.contingency ? `Contingency (${Math.round(contingency * 100)}%): ${kes(r.breakdown.contingency)}` : "",
    "",
    DISCLAIMER,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");

  const field = "h-10 w-full min-w-0 rounded-lg bg-[#0A0E14] border border-[#222A35] px-3 text-[14px] sm:text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]/60";
  const label = "block text-[11px] uppercase tracking-wider text-[#8A95A5] mb-1";
  const chip = (on: boolean) => `h-9 px-3 rounded-lg border text-[12.5px] ${on ? "border-[#FF6B1A] bg-[#FF6B1A]/10 text-white" : "border-[#222A35] text-[#C2CAD6] hover:text-white"}`;

  return (
    <div className="px-4 sm:px-8 py-5 max-w-5xl">
      <div className="mb-4">
        <h1 className="text-[20px] text-white font-display flex items-center gap-2"><Calculator className="w-5 h-5 text-[#FF8A47]" /> Cost of construction</h1>
        <p className="text-[13px] text-[#8A95A5] mt-0.5">A first budget for a building anywhere in Kenya, in seconds. Use it to talk money with a client, then let the AI write the detailed quote.</p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        {/* Inputs */}
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 sm:col-span-1"><span className={label}>Building</span>
              <select aria-label="Building type" value={buildingType} onChange={(e) => setType(e.target.value as BuildingKey)} className={field}>
                {Object.entries(BUILDING_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select></label>
            <label className="col-span-2 sm:col-span-1"><span className={label}>Where</span>
              <select aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value as LocationKey)} className={field}>
                {Object.entries(LOCATIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select></label>
            <label><span className={label}>Built-up area (m²)</span>
              <input aria-label="Built-up area" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} className={field} /></label>
            <label><span className={label}>Floors</span>
              <select aria-label="Floors" value={floors} onChange={(e) => setFloors(Number(e.target.value))} className={field}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? "1 (ground only)" : n}</option>)}
              </select></label>
          </div>
          <div>
            <span className={label}>Don't know the size? Pick bedrooms</span>
            <div className="flex flex-wrap gap-1.5">{BEDROOMS.map(([l, m]) => <button key={l} onClick={() => setArea(String(m))} className={chip(areaSqm === m)}>{l} · {m} m²</button>)}</div>
          </div>
          <div>
            <span className={label}>Finish</span>
            <div className="grid grid-cols-3 gap-1.5">{(Object.keys(FINISH_RATES) as FinishKey[]).map((k) => (
              <button key={k} onClick={() => setFinish(k)} title={FINISH_RATES[k].suits} className={`${chip(finish === k)} h-auto py-2 text-left`}>
                <span className="block">{FINISH_RATES[k].label}</span>
                <span className="block text-[10.5px] text-[#8A95A5] leading-tight">{FINISH_RATES[k].low / 1000}k–{FINISH_RATES[k].high / 1000}k per m²</span>
              </button>))}</div>
          </div>
          <div>
            <span className={label}>Site</span>
            <div className="flex flex-wrap gap-1.5">{(Object.keys(SITE_CONDITIONS) as SiteKey[]).map((k) => <button key={k} onClick={() => setSite(k)} className={chip(site === k)}>{SITE_CONDITIONS[k].label}</button>)}</div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-[#C2CAD6]">
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={fees} onChange={(e) => setFees(e.target.checked)} className="accent-[#FF6B1A] w-4 h-4" /> Professional fees (12%)</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={permits} onChange={(e) => setPermits(e.target.checked)} className="accent-[#FF6B1A] w-4 h-4" /> Approvals &amp; permits (2.5%)</label>
          </div>
          <div>
            <span className={label}>Contingency</span>
            <div className="flex flex-wrap gap-1.5">{CONTINGENCIES.map((c) => <button key={c} onClick={() => setContingency(c)} className={chip(contingency === c)}>{c ? `${Math.round(c * 100)}%` : "None"}</button>)}</div>
          </div>
        </div>

        {/* Result */}
        <div className="rounded-xl border border-[#FF6B1A]/35 bg-[#11161D] p-4 flex flex-col">
          <div className="text-[12px] uppercase tracking-wider text-[#8A95A5]">Likely total</div>
          <div className="text-[30px] sm:text-[34px] text-white font-display tabular-nums leading-tight">{areaSqm ? kes(r.mid) : "Enter the size"}</div>
          {areaSqm > 0 && <>
            <div className="text-[13px] text-[#C2CAD6] mt-1">Range {short(r.low)} to {short(r.high)} · about {kes(r.perSqm)} per m²</div>
            <div className="mt-4 text-[11px] uppercase tracking-wider text-[#8A95A5] mb-1.5">By stage (for payment requests and the programme)</div>
            <div className="divide-y divide-[#222A35] text-[13px]">
              {r.stages.map((s) => (
                <div key={s.stage} className="flex items-baseline justify-between gap-3 py-1.5"><span className="text-[#C2CAD6] min-w-0">{s.stage}</span><span className="text-white tabular-nums shrink-0">{kes(s.amount)}</span></div>
              ))}
              {r.breakdown.fees > 0 && <div className="flex justify-between gap-3 py-1.5"><span className="text-[#8A95A5]">Professional fees</span><span className="text-white tabular-nums">{kes(r.breakdown.fees)}</span></div>}
              {r.breakdown.permits > 0 && <div className="flex justify-between gap-3 py-1.5"><span className="text-[#8A95A5]">Approvals &amp; permits</span><span className="text-white tabular-nums">{kes(r.breakdown.permits)}</span></div>}
              {r.breakdown.contingency > 0 && <div className="flex justify-between gap-3 py-1.5"><span className="text-[#8A95A5]">Contingency</span><span className="text-white tabular-nums">{kes(r.breakdown.contingency)}</span></div>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => onAsk(`Write a detailed quote (BOQ) for a ${what}. My indicative budget is ${kes(r.mid)}. Price it from my own past rates, by stage.`)}
                className="h-10 px-4 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7E33] text-[#ffffff] text-[13px] font-medium inline-flex items-center gap-1.5"><Sparkles className="w-4 h-4" /> Turn into a detailed quote</button>
              <a href={`https://wa.me/?text=${encodeURIComponent(summary)}`} target="_blank" rel="noreferrer" className="h-10 px-3 rounded-lg bg-[#25D366] text-[#ffffff] text-[13px] inline-flex items-center gap-1.5"><MessageCircle className="w-4 h-4" /> Send on WhatsApp</a>
              <button onClick={() => navigator.clipboard?.writeText(summary).then(() => toast.success("Copied"))} className="h-10 px-3 rounded-lg border border-[#222A35] text-[13px] text-[#C2CAD6] hover:text-white inline-flex items-center gap-1.5"><Copy className="w-4 h-4" /> Copy</button>
            </div>
          </>}
          <p className="mt-auto pt-4 text-[11.5px] text-[#5B6675] leading-relaxed">{DISCLAIMER} Rates reviewed {RATES_UPDATED}.</p>
        </div>
      </div>
    </div>
  );
}
