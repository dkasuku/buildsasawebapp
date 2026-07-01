import { useState, useEffect } from "react";
import type { ElementType } from "react";
import { TrendingUp, DollarSign, Clock, FileCheck2, AlertTriangle, ArrowUpRight, Sparkles } from "lucide-react";
import type { View } from "./Sidebar";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import { useCurrency } from "./CurrencyContext";
import { formatCompactCurrency, formatCurrency } from "./currency";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import api from "../../services/api";

// Pricing base is KES; change-order amounts are stored in USD.
const USD_TO_KES = 130;
const OPEN_STATUSES = ["drafted", "pm_review", "owner_approval"];
const STATUS_TO_COL: Record<string, string> = {
  drafted: "Drafted",
  pm_review: "PM Review",
  owner_approval: "Owner Approval",
  approved: "Approved",
};
const PIPELINE_COLS = [
  { title: "Drafted", color: "#5B6675" },
  { title: "PM Review", color: "#3B82F6" },
  { title: "Owner Approval", color: "#FF6B1A" },
  { title: "Approved", color: "#22C55E" },
];

const daysSince = (d?: string) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 0);

type Kpi = { label: string; value: string; icon: ElementType; sub: string; delta: string; financial?: boolean; warn?: boolean };
type DashInsight = { title: string; detail?: string; changeOrderId?: string } | null;

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
  const { currency } = useCurrency();
  const perms = ROLES[role];
  const [projects, setProjects] = useState<any[]>([]);
  const [cos, setCos] = useState<any[]>([]);
  const [insight, setInsight] = useState<DashInsight>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([api.getProjects(), api.listChangeOrders()]).then((res) => {
      if (!alive) return;
      if (res[0].status === "fulfilled") setProjects((res[0].value as any[]) ?? []);
      if (res[1].status === "fulfilled") setCos((res[1].value as any[]) ?? []);
      setLoaded(true);
    });
    // Real, data-driven AI insight (null when there's nothing to report). Non-blocking.
    api.getDashboardInsight().then((d) => { if (alive) setInsight((d as DashInsight) ?? null); }).catch(() => { /* no insight */ });
    return () => { alive = false; };
  }, []);

  const emptyWorkspace = loaded && projects.length === 0 && cos.length === 0;

  const projName = (id?: string) => projects.find((p) => p.id === id)?.name || "—";
  const openCos = cos.filter((c) => OPEN_STATUSES.includes(c.status));
  const approvedCos = cos.filter((c) => c.status === "approved");
  const approvedValueKES = approvedCos.reduce((s, c) => s + (Number(c.costUSD) || 0) * USD_TO_KES, 0);
  const pendingApproval = cos.filter((c) => c.status === "owner_approval").length;
  const atRisk = openCos.filter((c) => daysSince(c.submittedDate) > 7).length;

  const realKpis: Kpi[] = [
    { label: "Approved CO Value", value: formatCompactCurrency(approvedValueKES, currency), icon: DollarSign, sub: "approved change orders", delta: "", financial: true },
    { label: "Open Change Orders", value: String(openCos.length), icon: FileCheck2, sub: "in progress", delta: "" },
    { label: "Pending Approval", value: String(pendingApproval), icon: Clock, sub: "awaiting owner", delta: "" },
    { label: "At-Risk (>7d open)", value: String(atRisk), icon: AlertTriangle, sub: "needs attention", delta: "", warn: atRisk > 0 },
  ];
  const visibleKpis = perms.financials ? realKpis : realKpis.filter((k) => !k.financial);

  const KPI_SHORTCUTS: Record<string, View> = {
    "Approved CO Value": "reports",
    "Open Change Orders": "change-orders",
    "Pending Approval": "change-orders",
    "At-Risk (>7d open)": "change-orders",
  };

  const pipeline = PIPELINE_COLS.map((col) => {
    const items = cos
      .filter((c) => STATUS_TO_COL[c.status] === col.title)
      .map((c) => ({
        key: c.id as string,
        id: (c.number || c.id) as string,
        project: projName(c.projectId),
        amount: formatCurrency((Number(c.costUSD) || 0) * USD_TO_KES, currency),
        urgent: OPEN_STATUSES.includes(c.status) && daysSince(c.submittedDate) > 7,
      }));
    return { ...col, items, count: items.length };
  });

  const statusBars = [
    { name: "Drafted", v: cos.filter((c) => c.status === "drafted").length },
    { name: "PM Review", v: cos.filter((c) => c.status === "pm_review").length },
    { name: "Owner", v: cos.filter((c) => c.status === "owner_approval").length },
    { name: "Approved", v: cos.filter((c) => c.status === "approved").length },
    { name: "Rejected", v: cos.filter((c) => c.status === "rejected").length },
  ];
  const valueBars = [
    { name: "Open", v: Math.round(openCos.reduce((s, c) => s + (Number(c.costUSD) || 0) * USD_TO_KES, 0)) },
    { name: "Approved", v: Math.round(approvedValueKES) },
  ];

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5 sm:space-y-6">
      {emptyWorkspace && (
        <div className="rounded-xl border border-[#FF6B1A]/30 bg-[#FF6B1A]/5 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div>
              <div className="text-[14px] text-white font-display">Welcome to Buildsasa</div>
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

      {insight && !emptyWorkspace && (
        <div className="relative overflow-hidden rounded-xl border border-[#222A35] bg-gradient-to-r from-[#161C24] to-[#11161D] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="absolute -right-20 -top-20 w-72 h-72 rounded-full bg-[#FF6B1A]/10 blur-3xl pointer-events-none" />
          <div className="flex items-start gap-3 relative z-10">
            <div className="w-9 h-9 rounded-lg bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-[#FF6B1A]" />
            </div>
            <div>
              <div className="text-[10px] text-[#FF6B1A] uppercase tracking-wider">AI Insight</div>
              <div className="text-[13px] sm:text-[14px] text-white mt-1 font-display">{insight.title}</div>
              {insight.detail && <div className="text-[12px] text-[#8A95A5] mt-0.5">{insight.detail}</div>}
            </div>
          </div>
          {insight.changeOrderId && (
            <button
              type="button"
              onClick={() => onOpenChangeOrder(insight.changeOrderId as string)}
              className="shrink-0 h-9 px-3 rounded-md bg-white/5 hover:bg-white/10 border border-[#222A35] hover:border-[#FF6B1A]/40 text-[12px] text-white flex items-center justify-center gap-1.5 transition self-start sm:self-auto relative z-10"
            >
              Open change order <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {visibleKpis.map((k) => (
          <div key={k.label} className="text-left rounded-xl border border-[#222A35] bg-[#11161D] p-4 sm:p-5 transition">
            <div className="flex items-start justify-between">
              <div className={`w-8 h-8 rounded-md flex items-center justify-center ${k.warn ? "bg-[#F5A623]/15 text-[#F5A623]" : "bg-[#FF6B1A]/15 text-[#FF6B1A]"}`}>
                <k.icon className="w-4 h-4" />
              </div>
              {k.delta && (
                <div className="flex items-center gap-1 text-[11px] text-[#8A95A5]">
                  <TrendingUp className="w-3 h-3" /> {k.delta}
                </div>
              )}
            </div>
            <div className="text-[22px] sm:text-[26px] text-white mt-3 tracking-tight font-display">{k.value}</div>
            <div className="text-[11px] text-[#8A95A5] mt-0.5">{k.label}</div>
            <div className="mt-2 pt-2 border-t border-[#222A35] flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#5B6675]">{k.sub}</span>
              {onNavigate && KPI_SHORTCUTS[k.label] && (
                <button
                  type="button"
                  onClick={() => onNavigate(KPI_SHORTCUTS[k.label])}
                  className="text-[10px] text-[#FF6B1A] hover:text-[#FF7E33] flex items-center gap-1"
                >
                  Open <ArrowUpRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 sm:p-5">
          <div className="text-[13px] text-white font-display">Change Orders by Status</div>
          <div className="text-[11px] text-[#8A95A5]">Across your workspace</div>
          <div className="relative h-[200px] sm:h-[220px] mt-4">
            <ResponsiveContainer>
              <BarChart data={statusBars}>
                <CartesianGrid stroke="#222A35" vertical={false} />
                <XAxis dataKey="name" stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#0A0E14", border: "1px solid #222A35", borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="v" fill="#FF6B1A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            {cos.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-center px-6 text-[12px] text-[#5B6675]">No data yet — analytics appear here as you add change orders.</div>
            )}
          </div>
        </div>
        {perms.financials && (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 sm:p-5">
          <div className="text-[13px] text-white font-display">Change Order Value</div>
          <div className="text-[11px] text-[#8A95A5]">Open vs approved</div>
          <div className="relative h-[200px] sm:h-[220px] mt-4">
            <ResponsiveContainer>
              <BarChart data={valueBars}>
                <CartesianGrid stroke="#222A35" vertical={false} />
                <XAxis dataKey="name" stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} width={70} tickFormatter={(v: any) => formatCompactCurrency(Number(v), currency)} />
                <Tooltip contentStyle={{ background: "#0A0E14", border: "1px solid #222A35", borderRadius: 8, fontSize: 11 }} formatter={(v: any) => formatCurrency(Number(v), currency)} />
                <Bar dataKey="v" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            {cos.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-center px-6 text-[12px] text-[#5B6675]">No data yet — values appear here as you add change orders.</div>
            )}
          </div>
        </div>
        )}
      </div>

      {!emptyWorkspace && perms.viewKanban && (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
            <div>
              <div className="text-[13px] text-white font-display">Change Order Pipeline</div>
              <div className="text-[11px] text-[#8A95A5]">Tap a card to open · {cos.length} total across {projects.length} project{projects.length === 1 ? "" : "s"}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {pipeline.map((col) => (
              <div key={col.title} className="bg-[#0A0E14] rounded-lg border border-[#222A35] p-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: col.color }} />
                    <span className="text-[12px] text-white font-display">{col.title}</span>
                    <span className="text-[10px] text-[#5B6675]">{col.count}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {col.items.map((it) => (
                    <button
                      key={it.key}
                      onClick={() => onOpenChangeOrder(it.key)}
                      className="w-full text-left p-3 rounded-md bg-[#11161D] border border-[#222A35] hover:border-[#FF6B1A]/50 transition"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[#5B6675] font-mono">{it.id}</span>
                        {it.urgent && <span className="text-[9px] text-[#EF4444] uppercase tracking-wider">Overdue</span>}
                      </div>
                      <div className="text-[12px] text-white mt-1.5">{it.project}</div>
                      <div className="mt-2 pt-2 border-t border-[#222A35] text-[12px] text-[#FF6B1A]">{it.amount}</div>
                    </button>
                  ))}
                  {col.items.length === 0 && (
                    <div className="text-[11px] text-[#5B6675] px-2 py-3">None.</div>
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
