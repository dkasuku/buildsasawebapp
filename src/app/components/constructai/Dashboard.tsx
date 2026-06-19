import { useState, useEffect } from "react";
import { toast } from "sonner";
import { TrendingUp, TrendingDown, DollarSign, Clock, FileCheck2, AlertTriangle, MoreHorizontal, ArrowUpRight, ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import type { View } from "./Sidebar";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import { useCurrency } from "./CurrencyContext";
import { formatCompactCurrency, formatCurrency } from "./currency";
import api from "../../services/api";

const revenueSeries: Record<string, { m: string; v: number }[]> = {
  "7D": [
    { m: "Mon", v: 62 }, { m: "Tue", v: 71 }, { m: "Wed", v: 66 },
    { m: "Thu", v: 78 }, { m: "Fri", v: 84 }, { m: "Sat", v: 72 }, { m: "Sun", v: 90 },
  ],
  "30D": [
    { m: "Wk1", v: 210 }, { m: "Wk2", v: 280 }, { m: "Wk3", v: 340 },
    { m: "Wk4", v: 410 }, { m: "Wk5", v: 455 },
  ],
  "QTD": [
    { m: "Apr", v: 420 }, { m: "May", v: 610 }, { m: "Jun", v: 720 },
  ],
  "YTD": [
    { m: "Jan", v: 320 }, { m: "Feb", v: 410 }, { m: "Mar", v: 380 },
    { m: "Apr", v: 540 }, { m: "May", v: 612 }, { m: "Jun", v: 698 },
    { m: "Jul", v: 742 }, { m: "Aug", v: 821 }, { m: "Sep", v: 945 },
  ],
};

const cycleData = [
  { m: "Mon", v: 3.2 }, { m: "Tue", v: 4.1 }, { m: "Wed", v: 2.8 },
  { m: "Thu", v: 5.2 }, { m: "Fri", v: 3.9 }, { m: "Sat", v: 1.2 }, { m: "Sun", v: 0.8 },
];

// Amounts stored in KES (Kenyan Shillings) - base currency
const REVENUE_KES = 1_612_000_000; // ~$12.4M equivalent

const kpis = (currency: ReturnType<typeof useCurrency>["currency"]) => [
  { label: "Revenue Impact (YTD)", value: formatCompactCurrency(REVENUE_KES, currency), delta: "+18.2%", up: true, icon: DollarSign, sub: "vs last year" },
  { label: "Open Change Orders", value: "247", delta: "+12", up: true, icon: FileCheck2, sub: "this week", neutral: true },
  { label: "Avg. Approval Cycle", value: "3.4d", delta: "-1.1d", up: false, icon: Clock, sub: "improving" },
  { label: "At-Risk Orders", value: "18", delta: "+3", up: true, icon: AlertTriangle, sub: "needs review", warn: true },
];

// Helper to convert dollar amounts to KES base amounts
// $1 ≈ 130 KES
const $toKES = (dollars: number) => Math.round(dollars * 130);

const CO_AMOUNTS_KES: Record<string, number> = {
  "CO-1284": $toKES(24500),
  "CO-1285": $toKES(8120),
  "CO-1286": $toKES(62300),
  "CO-1271": $toKES(118400),
  "CO-1268": $toKES(42000),
  "CO-1265": $toKES(15200),
  "CO-1258": $toKES(284000),
  "CO-1257": $toKES(96500),
  "CO-1240": $toKES(52400),
  "CO-1239": $toKES(18900),
  "CO-1238": $toKES(210000),
};

const MY_QUEUE_IDS = new Set(["CO-1284", "CO-1258", "CO-1239"]);
const ESCALATED_IDS = new Set(["CO-1271", "CO-1258", "CO-1238"]);

const filterColumns = (
  cols: ReturnType<typeof getColumns>,
  activeFilter: string,
) => {
  if (activeFilter === "All Projects") return cols;
  const filterSet = activeFilter === "My Queue" ? MY_QUEUE_IDS : ESCALATED_IDS;
  return cols.map((col) => {
    const items = col.items.filter((it) => filterSet.has(it.id));
    return { ...col, items, count: items.length };
  });
};

const getColumns = (currency: ReturnType<typeof useCurrency>["currency"]) => [
  {
    title: "Drafted", count: 8, color: "#5B6675",
    items: [
      { id: "CO-1284", project: "Harborfront Tower", amount: formatCurrency(CO_AMOUNTS_KES["CO-1284"], currency), urgency: "low" },
      { id: "CO-1285", project: "Midtown Medical", amount: formatCurrency(CO_AMOUNTS_KES["CO-1285"], currency), urgency: "low" },
      { id: "CO-1286", project: "Riverside Plaza", amount: formatCurrency(CO_AMOUNTS_KES["CO-1286"], currency), urgency: "med" },
    ],
  },
  {
    title: "PM Review", count: 12, color: "#3B82F6",
    items: [
      { id: "CO-1271", project: "Harborfront Tower", amount: formatCurrency(CO_AMOUNTS_KES["CO-1271"], currency), urgency: "high" },
      { id: "CO-1268", project: "Sunset Logistics", amount: formatCurrency(CO_AMOUNTS_KES["CO-1268"], currency), urgency: "med" },
      { id: "CO-1265", project: "Cedar Heights", amount: formatCurrency(CO_AMOUNTS_KES["CO-1265"], currency), urgency: "low" },
    ],
  },
  {
    title: "Owner Approval", count: 6, color: "#FF6B1A",
    items: [
      { id: "CO-1258", project: "Midtown Medical", amount: formatCurrency(CO_AMOUNTS_KES["CO-1258"], currency), urgency: "high" },
      { id: "CO-1257", project: "Harborfront Tower", amount: formatCurrency(CO_AMOUNTS_KES["CO-1257"], currency), urgency: "high" },
    ],
  },
  {
    title: "Approved", count: 31, color: "#22C55E",
    items: [
      { id: "CO-1240", project: "Cedar Heights", amount: formatCurrency(CO_AMOUNTS_KES["CO-1240"], currency), urgency: "done" },
      { id: "CO-1239", project: "Sunset Logistics", amount: formatCurrency(CO_AMOUNTS_KES["CO-1239"], currency), urgency: "done" },
      { id: "CO-1238", project: "Riverside Plaza", amount: formatCurrency(CO_AMOUNTS_KES["CO-1238"], currency), urgency: "done" },
    ],
  },
];

const RANGES = ["7D", "30D", "QTD", "YTD"];
const FILTERS = ["All Projects", "My Queue", "Escalated"];
const PIPELINE_FLOW = ["Drafted", "PM Review", "Owner Approval", "Approved"];

const nextPipelineStatus = (status: string) => {
  const index = PIPELINE_FLOW.indexOf(status);
  if (index === -1) return PIPELINE_FLOW[0];
  return PIPELINE_FLOW[Math.min(index + 1, PIPELINE_FLOW.length - 1)];
};

const prevPipelineStatus = (status: string) => {
  const index = PIPELINE_FLOW.indexOf(status);
  if (index <= 0) return PIPELINE_FLOW[0];
  return PIPELINE_FLOW[Math.max(index - 1, 0)];
};

export function Dashboard({
  role = "Contractor",
  onOpenChangeOrder,
  onNavigate,
}: {
  setView?: (v: View) => void;
  role?: Role;
  onOpenChangeOrder: (id: string, status?: string) => void;
  onNavigate?: (v: View) => void;
}) {
  const [range, setRange] = useState("YTD");
  const [filter, setFilter] = useState("All Projects");
  const { currency } = useCurrency();
  // Show a getting-started banner only when the workspace has no projects yet.
  const [emptyWorkspace, setEmptyWorkspace] = useState(false);
  useEffect(() => {
    api.getProjects().then((d) => setEmptyWorkspace((d ?? []).length === 0)).catch(() => { /* offline: hide banner */ });
  }, []);
  const perms = ROLES[role];
  const visibleKpis = perms.financials ? kpis(currency) : kpis(currency).filter((k) => !/Revenue/.test(k.label));
  const [pipelineStatus, setPipelineStatus] = useState<Record<string, string>>({});
  const baseColumns = getColumns(currency);
  const columns = baseColumns.map((col) => ({ ...col, items: [] as typeof col.items }));
  const columnIndex = new Map(baseColumns.map((col, index) => [col.title, index]));

  baseColumns.forEach((col, colIdx) => {
    col.items.forEach((item) => {
      const status = pipelineStatus[item.id] ?? col.title;
      const targetIndex = columnIndex.get(status) ?? colIdx;
      columns[targetIndex].items.push(item);
    });
  });

  const columnsWithCounts = columns.map((col) => ({ ...col, count: col.items.length }));
  const pipelineColumns = filterColumns(columnsWithCounts, filter);
  const revenueData = revenueSeries[range] ?? revenueSeries.YTD;
  
  // Calculate total pending in current currency
  const totalPendingKES = CO_AMOUNTS_KES["CO-1258"] + CO_AMOUNTS_KES["CO-1257"];
  const totalPendingDisplay = formatCompactCurrency(totalPendingKES, currency);

  const KPI_SHORTCUTS: Record<string, View> = {
    "Revenue Impact (YTD)": "reports",
    "Open Change Orders": "change-order",
    "Avg. Approval Cycle": "reports",
    "At-Risk Orders": "tasks",
  };

  const applyStatus = (id: string, fallback: string) => pipelineStatus[id] ?? fallback;

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5 sm:space-y-6">
      {emptyWorkspace && (
        <div className="rounded-xl border border-[#FF6B1A]/30 bg-[#FF6B1A]/5 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#FF6B1A]/15 flex items-center justify-center shrink-0">
              <Sparkles className="w-[18px] h-[18px] text-[#FF6B1A]" />
            </div>
            <div>
              <div className="text-[14px] text-white font-display">Welcome to Buildflex</div>
              <div className="text-[12px] text-[#8A95A5]">Start by creating your first project, then turn a paper form into a smart checklist with AI.</div>
            </div>
          </div>
          {onNavigate && (
            <div className="flex gap-2 shrink-0">
              <button onClick={() => onNavigate("projects")} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px]">Create a project</button>
              <button onClick={() => onNavigate("checklists")} className="h-9 px-4 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white text-[12px]">Explore checklists</button>
            </div>
          )}
        </div>
      )}
      <div className="relative overflow-hidden rounded-xl border border-[#222A35] bg-gradient-to-r from-[#161C24] to-[#11161D] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="absolute -right-20 -top-20 w-72 h-72 rounded-full bg-[#FF6B1A]/10 blur-3xl pointer-events-none" />
        <div className="flex items-start gap-3 relative z-10">
          <div className="w-9 h-9 rounded-lg bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-[#FF6B1A]" />
          </div>
          <div>
            <div className="text-[10px] text-[#FF6B1A] uppercase tracking-wider">AI Insight · 2 min ago</div>
            <div className="text-[13px] sm:text-[14px] text-white mt-1 font-display">
              Midtown Medical change orders are 2.3× slower than portfolio average.
            </div>
            <div className="text-[12px] text-[#8A95A5] mt-0.5">
              3 orders totaling {totalPendingDisplay} pending owner approval for &gt; 7 days. Escalate to Jane Cho.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpenChangeOrder("CO-1258")}
          className="shrink-0 h-9 px-3 rounded-md bg-white/5 hover:bg-white/10 border border-[#222A35] hover:border-[#FF6B1A]/40 text-[12px] text-white flex items-center justify-center gap-1.5 transition self-start sm:self-auto relative z-10"
        >
          Open recommendation <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {visibleKpis.map((k) => (
          <div
            key={k.label}
            className="text-left rounded-xl border border-[#222A35] bg-[#11161D] p-4 sm:p-5 transition"
          >
            <div className="flex items-start justify-between">
              <div className={`w-8 h-8 rounded-md flex items-center justify-center ${k.warn ? "bg-[#F5A623]/15 text-[#F5A623]" : "bg-[#FF6B1A]/15 text-[#FF6B1A]"}`}>
                <k.icon className="w-4 h-4" />
              </div>
              <div className={`flex items-center gap-1 text-[11px] ${k.neutral ? "text-[#8A95A5]" : k.up ? (k.warn ? "text-[#F5A623]" : "text-[#22C55E]") : "text-[#22C55E]"}`}>
                {k.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />} {k.delta}
              </div>
            </div>
            <div className="text-[22px] sm:text-[26px] text-white mt-3 tracking-tight font-display">{k.value}</div>
            <div className="text-[11px] text-[#8A95A5] mt-0.5">{k.label}</div>
            <div className="mt-2 pt-2 border-t border-[#222A35] flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#5B6675]">{k.sub}</span>
              {onNavigate && KPI_SHORTCUTS[k.label] && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate(KPI_SHORTCUTS[k.label]);
                  }}
                  className="text-[10px] text-[#FF6B1A] hover:text-[#FF7E33] flex items-center gap-1"
                >
                  Open <ArrowUpRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {perms.financials && (
        <div className="lg:col-span-2 rounded-xl border border-[#222A35] bg-[#11161D] p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4 gap-2">
            <div className="min-w-0">
              <div className="text-[13px] text-white font-display">Revenue Impact</div>
              <div className="text-[11px] text-[#8A95A5] truncate">Cumulative approved change orders · {range}</div>
            </div>
            <div className="flex gap-1 text-[11px] shrink-0">
              {RANGES.map((t) => (
                <button
                  key={t}
                  onClick={() => { setRange(t); toast(`Range: ${t}`); }}
                  className={`px-2.5 py-1 rounded ${range === t ? "bg-[#FF6B1A]/15 text-[#FF6B1A]" : "text-[#8A95A5] hover:text-white"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[200px] sm:h-[220px]">
            <ResponsiveContainer>
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FF6B1A" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#FF6B1A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#222A35" vertical={false} />
                <XAxis dataKey="m" stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#0A0E14", border: "1px solid #222A35", borderRadius: 8, fontSize: 11 }} />
                <Area type="monotone" dataKey="v" stroke="#FF6B1A" strokeWidth={2} fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        )}

        <div className={`rounded-xl border border-[#222A35] bg-[#11161D] p-4 sm:p-5 ${!perms.financials ? "lg:col-span-3" : ""}`}>
          <div className="text-[13px] text-white font-display">Approval Velocity</div>
          <div className="text-[11px] text-[#8A95A5]">Avg. days by weekday</div>
          <div className="h-[200px] sm:h-[220px] mt-4">
            <ResponsiveContainer>
              <BarChart data={cycleData}>
                <CartesianGrid stroke="#222A35" vertical={false} />
                <XAxis dataKey="m" stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#0A0E14", border: "1px solid #222A35", borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="v" fill="#FF6B1A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {perms.viewKanban && (
      <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
          <div>
            <div className="text-[13px] text-white font-display">Change Order Pipeline</div>
            <div className="text-[11px] text-[#8A95A5]">Tap a card to open · 57 active across 12 projects</div>
          </div>
          <div className="flex gap-1.5 text-[11px] overflow-x-auto">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); toast(`Filter: ${f}`); }}
                className={`px-2.5 py-1 rounded whitespace-nowrap ${filter === f ? "bg-[#161C24] text-white border border-[#222A35]" : "text-[#8A95A5] hover:text-white"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {pipelineColumns.map((col) => (
            <div key={col.title} className="bg-[#0A0E14] rounded-lg border border-[#222A35] p-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: col.color }} />
                  <span className="text-[12px] text-white font-display">{col.title}</span>
                  <span className="text-[10px] text-[#5B6675]">{col.count}</span>
                </div>
                <MoreHorizontal className="w-3.5 h-3.5 text-[#5B6675]" />
              </div>
              <div className="space-y-2">
                {col.items.map((it) => {
                  const currentStatus = applyStatus(it.id, col.title);
                  const isFinal = currentStatus === PIPELINE_FLOW[PIPELINE_FLOW.length - 1];
                  const isFirst = currentStatus === PIPELINE_FLOW[0];

                  return (
                    <button
                      key={it.id}
                      onClick={() => {
                        setPipelineStatus((prev) => ({ ...prev, [it.id]: col.title }));
                        onOpenChangeOrder(it.id, col.title);
                      }}
                      className="w-full text-left p-3 rounded-md bg-[#11161D] border border-[#222A35] hover:border-[#FF6B1A]/50 transition"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[#5B6675] font-mono">{it.id}</span>
                        {it.urgency === "high" && <span className="text-[9px] text-[#EF4444] uppercase tracking-wider">Urgent</span>}
                        {it.urgency === "med" && <span className="text-[9px] text-[#F5A623] uppercase tracking-wider">Med</span>}
                      </div>
                      <div className="text-[12px] text-white mt-1.5">{it.project}</div>
                      <div className="text-[10px] text-[#8A95A5] mt-1">Status: {currentStatus}</div>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#222A35] gap-2">
                        <div className="text-[12px] text-[#FF6B1A]">{it.amount}</div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isFirst) {
                                toast(`${it.id} is already Drafted`);
                                return;
                              }
                              const prevStatus = prevPipelineStatus(currentStatus);
                              setPipelineStatus((prev) => ({ ...prev, [it.id]: prevStatus }));
                              toast(`Moved ${it.id} to ${prevStatus}`);
                            }}
                            disabled={isFirst}
                            className={`h-7 w-7 rounded-md border border-[#222A35] text-[#8A95A5] flex items-center justify-center ${isFirst ? "opacity-40 cursor-not-allowed" : "hover:text-white hover:border-[#FF6B1A]/40"}`}
                            aria-label={`Move ${it.id} to previous stage`}
                          >
                            <ArrowLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isFinal) {
                                toast(`${it.id} is already Approved`);
                                return;
                              }
                              const nextStatus = nextPipelineStatus(currentStatus);
                              setPipelineStatus((prev) => ({ ...prev, [it.id]: nextStatus }));
                              toast(`Moved ${it.id} to ${nextStatus}`);
                            }}
                            disabled={isFinal}
                            className={`h-7 w-7 rounded-md border border-[#222A35] text-[#8A95A5] flex items-center justify-center ${isFinal ? "opacity-40 cursor-not-allowed" : "hover:text-white hover:border-[#FF6B1A]/40"}`}
                            aria-label={`Move ${it.id} to next stage`}
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                          <div className="flex -space-x-1.5">
                            {["#3B82F6", "#8B5CF6"].map((c, i) => (
                              <div key={i} className="w-5 h-5 rounded-full border border-[#11161D]" style={{ background: c }} />
                            ))}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {col.items.length === 0 && (
                  <div className="text-[11px] text-[#5B6675] px-2 py-3">No items in this filter.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}
