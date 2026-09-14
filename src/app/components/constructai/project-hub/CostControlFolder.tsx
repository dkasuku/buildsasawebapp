// ============================================================================
// Cost & Control Budgeting — the QS's live position on the job:
//
//   * Actual spend against the original BOQ budget, per category
//   * Cost-to-complete and forecast final cost, moving as variations, subcontracts
//     and payments are logged
//   * Cash flow: what has come in and gone out by month, and what is expected
//
// All figures are computed on the server (see project-hub.js → costControl) from
// the same rows every other module writes, so this page cannot disagree with
// Financials, Commitments or the variation log.
// ============================================================================

import { useMemo } from "react";
import { Area, Bar as RBar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingDown, TrendingUp, Wallet } from "lucide-react";
import type { CostControlDto } from "../../../services/api";
import type { View } from "../Sidebar";
import { Bar, Empty, Kpi, Panel, btnGhost, useMoney } from "./shared";

export function CostControlFolder({ costs, setView, onSetContractSum }: { costs: CostControlDto; setView: (v: View) => void; onSetContractSum: () => void }) {
  const { fmt, compact } = useMoney();
  const budgetPct = costs.revisedBudget > 0 ? Math.round((costs.actual / costs.revisedBudget) * 100) : null;
  const over = costs.variance < 0;

  const chart = useMemo(() => costs.cashflow.map((m) => ({
    ...m,
    label: new Date(`${m.month}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
    out: -(m.cashOut + m.forecastOut),
    inflow: m.cashIn + m.certified + m.forecastIn,
    isForecast: m.forecastOut > 0 || m.forecastIn > 0,
  })), [costs.cashflow]);

  const noData = costs.originalBudget === 0 && costs.actual === 0 && costs.committed === 0 && costs.contractSum == null;

  return (
    <div className="space-y-4">
      {/* Headline position */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label={costs.budgetSource === "boq" ? "Budget (from BOQ)" : "Budget"}
          value={costs.originalBudget ? fmt(costs.revisedBudget) : "—"}
          sub={costs.originalBudget
            ? (costs.approvedVariations ? `${fmt(costs.originalBudget)} original ${costs.approvedVariations >= 0 ? "+" : "−"} ${fmt(Math.abs(costs.approvedVariations))} variations` : "no approved variations yet")
            : "price the BOQ or set category budgets"}
        />
        <Kpi label="Actual spend" value={costs.actual ? fmt(costs.actual) : "—"} tone={budgetPct != null && budgetPct > 100 ? "bad" : undefined} sub={budgetPct == null ? "booked against cost categories" : `${budgetPct}% of budget used`} />
        <Kpi label="Cost to complete" value={fmt(costs.costToComplete)} sub={`committed ${compact(costs.committed)} · paid to subs ${compact(costs.paidToSubs)}`} />
        <Kpi label="Forecast final cost" value={fmt(costs.forecastFinalCost)} tone={over ? "bad" : "good"} sub={costs.originalBudget ? `${over ? "over" : "under"} budget by ${fmt(Math.abs(costs.variance))}` : "actual + cost to complete"} />
      </div>

      {noData ? (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
          <Empty icon={Wallet} title="Nothing to control yet" hint="Cost control needs a budget to measure against. Price the bill of quantities and set the contract sum; then book spend in Financials and log variations here.">
            <button onClick={onSetContractSum} className={btnGhost}>Set contract sum</button>
            <button onClick={() => setView("financials")} className={btnGhost}>Open Financials</button>
          </Empty>
        </div>
      ) : (
        <>
          {/* Margin: the number the business actually cares about */}
          {costs.revisedContractSum != null && (
            <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="text-[11px] text-[#8A95A5]">Revised contract sum (income)</div>
                <div className="text-[18px] text-white font-display">{fmt(costs.revisedContractSum)}</div>
                <div className="text-[10.5px] text-[#5B6675]">{fmt(costs.certifiedToDate)} certified · {fmt(costs.paidToDate)} paid · {fmt(costs.retentionHeld)} retention held</div>
              </div>
              <div>
                <div className="text-[11px] text-[#8A95A5]">Forecast final cost</div>
                <div className="text-[18px] text-white font-display">{fmt(costs.forecastFinalCost)}</div>
                <div className="text-[10.5px] text-[#5B6675]">actual {fmt(costs.actual)} + to complete {fmt(costs.costToComplete)}</div>
              </div>
              <div>
                <div className="text-[11px] text-[#8A95A5]">Forecast margin</div>
                {(() => { const m = costs.revisedContractSum! - costs.forecastFinalCost; const pct = costs.revisedContractSum ? Math.round((m / costs.revisedContractSum) * 1000) / 10 : 0; return (
                  <>
                    <div className={`text-[18px] font-display flex items-center gap-1.5 ${m >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>{m >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}{fmt(m)}</div>
                    <div className="text-[10.5px] text-[#5B6675]">{pct}% of the revised contract sum</div>
                  </>
                ); })()}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Panel title="Budget vs actual by category" subtitle={costs.budgetSource === "boq" ? "Categories mirror the BOQ sections once “Use as project budget” is applied" : "From the cost categories in Financials"} action={<button onClick={() => setView("financials")} className="text-[11px] text-[#FF6B1A] hover:underline">Open Financials</button>}>
              {costs.categories.length === 0 ? (
                <Empty icon={Wallet} title="No cost categories" hint="Apply the BOQ as the budget, or add categories in Financials." />
              ) : (
                <div className="divide-y divide-[#222A35]">
                  {costs.categories.map((c) => {
                    const pct = c.budget > 0 ? Math.round((c.actual / c.budget) * 100) : (c.actual > 0 ? 101 : 0);
                    const bad = pct > 100;
                    return (
                      <div key={c.id} className="px-4 py-2.5">
                        <div className="flex items-center justify-between text-[12px] gap-3">
                          <span className="text-white truncate">{c.name}</span>
                          <span className={`tabular-nums shrink-0 ${bad ? "text-[#EF4444]" : "text-[#8A95A5]"}`}>{compact(c.actual)} / {c.budget ? compact(c.budget) : "no budget"}</span>
                        </div>
                        <div className="mt-1.5"><Bar pct={Math.min(100, pct)} tone={bad ? "bad" : pct > 85 ? "warn" : "good"} /></div>
                      </div>
                    );
                  })}
                  <div className="px-4 py-2.5 flex items-center justify-between text-[12px] bg-[#0A0E14]/60">
                    <span className="text-[#8A95A5]">Total</span>
                    <span className="text-white tabular-nums">{compact(costs.actual)} / {compact(costs.categories.reduce((s, c) => s + c.budget, 0))}</span>
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Cash flow" subtitle="Actual in/out by month; from this month on, the forecast to completion">
              {chart.length === 0 ? (
                <Empty icon={Wallet} title="No cash movements yet" hint="Ledger entries and certificates appear here by month." />
              ) : (
                <div className="p-3">
                  <div className="h-[260px]">
                    <ResponsiveContainer>
                      <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="#222A35" vertical={false} />
                        <XAxis dataKey="label" stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} />
                        <YAxis stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} tickFormatter={(v) => `${Number(v) < 0 ? "−" : ""}${compact(Math.abs(Number(v)))}`} width={64} />
                        <Tooltip
                          contentStyle={{ background: "#0A0E14", border: "1px solid #222A35", borderRadius: 8, fontSize: 11 }}
                          formatter={(v: any, name: any) => [fmt(Math.abs(Number(v))), name]}
                          labelFormatter={(l: any, payload: any) => `${l}${payload?.[0]?.payload?.isForecast ? " · forecast" : ""}`}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <RBar dataKey="inflow" name="In (certified / received)" fill="#22C55E" radius={[3, 3, 0, 0]} />
                        <RBar dataKey="out" name="Out (spend)" fill="#EF4444" radius={[0, 0, 3, 3]} />
                        <Area type="monotone" dataKey="cumulative" name="Cumulative net" stroke="#FF6B1A" fill="#FF6B1A" fillOpacity={0.08} strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="cumulative" stroke="#FF6B1A" strokeWidth={0} dot={false} legendType="none" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                    <div><div className="text-[10px] text-[#5B6675] uppercase">Received</div><div className="text-[12.5px] text-[#22C55E] tabular-nums">{compact(costs.cashflow.reduce((s, m) => s + m.cashIn, 0))}</div></div>
                    <div><div className="text-[10px] text-[#5B6675] uppercase">Spent</div><div className="text-[12.5px] text-[#EF4444] tabular-nums">{compact(costs.cashflow.reduce((s, m) => s + m.cashOut, 0))}</div></div>
                    <div><div className="text-[10px] text-[#5B6675] uppercase">Forecast to spend</div><div className="text-[12.5px] text-white tabular-nums">{compact(costs.costToComplete)}</div></div>
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div className="rounded-xl border border-[#222A35] bg-[#0A0E14] px-4 py-3 text-[11px] text-[#8A95A5] leading-relaxed">
            <span className="text-[#C2CAD6]">How the forecast is worked out.</span> Budget is the priced BOQ (or the category budgets when there is no bill) plus approved variations.
            Cost to complete is whatever is larger of the revised budget and the committed subcontracts, less what has actually been spent — so a subcontract let above the estimate moves the forecast immediately.
            Cash flow spreads the cost to complete and the uncertified balance of the contract evenly over the months left to the target end date.
          </div>
        </>
      )}
    </div>
  );
}
