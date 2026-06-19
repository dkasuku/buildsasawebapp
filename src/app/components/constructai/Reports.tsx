import { useState, useEffect } from "react";
import { toast } from "sonner";
import api, { type ScheduledReportDto } from "../../services/api";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { Download, Calendar, Filter, TrendingUp, ArrowUpRight, ArrowDownRight, Plus, GripVertical, X, MapPin, Building2, Clock, AlertTriangle, CheckCircle2, Bell, Mail, Repeat, Trash2, Play } from "lucide-react";
import { BarChart, Bar, LineChart, Line, RadialBarChart, RadialBar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, AreaChart, Area } from "recharts";
import { useCurrency } from "./CurrencyContext";
import { formatCompactCurrency, formatCurrency } from "./currency";

const $toKES = (dollars: number) => Math.round(dollars * 130);

const TABS = ["Financial", "Operational", "By Project", "By Region", "Custom", "Scheduled"] as const;
type Tab = typeof TABS[number];

const monthly = [
  { m: "Oct", approved: 1.2, pending: 0.8, rejected: 0.1 },
  { m: "Nov", approved: 1.6, pending: 0.6, rejected: 0.15 },
  { m: "Dec", approved: 2.1, pending: 0.9, rejected: 0.2 },
  { m: "Jan", approved: 1.8, pending: 1.1, rejected: 0.1 },
  { m: "Feb", approved: 2.4, pending: 0.7, rejected: 0.18 },
  { m: "Mar", approved: 2.9, pending: 1.3, rejected: 0.22 },
  { m: "Apr", approved: 3.4, pending: 1.0, rejected: 0.14 },
  { m: "May", approved: 4.1, pending: 1.4, rejected: 0.19 },
];

const triggers = [
  { name: "Design clarification", v: 38, c: "#FF6B1A" },
  { name: "Owner request", v: 24, c: "#3B82F6" },
  { name: "Unforeseen condition", v: 18, c: "#F5A623" },
  { name: "Code compliance", v: 12, c: "#8B5CF6" },
  { name: "Weather / delays", v: 8, c: "#22C55E" },
];

const velocity = [
  { d: "W1", v: 5.2 }, { d: "W2", v: 4.8 }, { d: "W3", v: 4.1 }, { d: "W4", v: 3.6 },
  { d: "W5", v: 3.4 }, { d: "W6", v: 2.9 }, { d: "W7", v: 3.1 }, { d: "W8", v: 2.6 },
];

const projects = [
  { p: "Harborfront Tower", region: "PNW", value: 2400, cos: 42, cycle: 3.1, health: 92 },
  { p: "Midtown Medical", region: "PNW", value: 1100, cos: 28, cycle: 5.4, health: 68 },
  { p: "Riverside Plaza", region: "NorCal", value: 640, cos: 19, cycle: 2.8, health: 96 },
  { p: "Cedar Heights", region: "Mountain", value: 92, cos: 6, cycle: 1.9, health: 88 },
  { p: "Sunset Logistics", region: "Southwest", value: 1800, cos: 24, cycle: 3.7, health: 84 },
  { p: "Crescent Bay", region: "SoCal", value: 320, cos: 11, cycle: 2.2, health: 94 },
];

const regions = [
  { r: "Pacific Northwest", v: 3.5, projects: 2, color: "#FF6B1A" },
  { r: "Northern California", v: 0.64, projects: 1, color: "#3B82F6" },
  { r: "Southern California", v: 0.32, projects: 1, color: "#22C55E" },
  { r: "Southwest", v: 1.8, projects: 1, color: "#F5A623" },
  { r: "Mountain", v: 0.09, projects: 1, color: "#8B5CF6" },
];

const RANGES = ["7D", "30D", "QTD", "YTD"];
const WIDGETS = ["Revenue trend", "Approval rate", "Cycle time", "Triggers", "Bottlenecks", "Region map", "Top projects", "SLA tracker"];

type SchedRow = { id: string; name: string; reportType: string; frequency: string; recipients: string; active: boolean; nextRun: string };

const fmtNextRun = (r: ScheduledReportDto): string =>
  r.nextRunAt
    ? new Date(r.nextRunAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })
    : (r.frequency ? `Next ${r.frequency}` : "Pending");

const toRow = (r: ScheduledReportDto): SchedRow => ({
  id: r.id, name: r.name, reportType: r.reportType, frequency: r.frequency,
  recipients: r.recipients, active: r.active, nextRun: fmtNextRun(r),
});

// Fallback shown only when the backend is unreachable
const DEMO_SCHEDULED: SchedRow[] = [
  { id: "sr-1", name: "Weekly Financial Summary", reportType: "Financial", frequency: "weekly", recipients: "pm@buildflex.com", active: true, nextRun: "Mon 08:00" },
  { id: "sr-2", name: "Safety Inspection Digest", reportType: "Operational", frequency: "daily", recipients: "safety@buildflex.com", active: true, nextRun: "Tomorrow 07:00" },
];

export function Reports() {
  const { currency } = useCurrency();
  const [tab, setTab] = useState<Tab>("Financial");
  const [range, setRange] = useState("YTD");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<{ region: string; minValue: number }>({ region: "All", minValue: 0 });
  const [customWidgets, setCustomWidgets] = useState<string[]>(["Revenue trend", "Approval rate", "Region map"]);
  const [scheduled, setScheduled] = useState<SchedRow[]>([]);
  const loadScheduled = async () => {
    try {
      const rows = await api.getScheduledReports();
      setScheduled(rows.map(toRow));
    } catch {
      // Backend unavailable — fall back to demo data so the panel isn't empty
      setScheduled(DEMO_SCHEDULED);
    }
  };
  useEffect(() => { loadScheduled(); }, []);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ name: "", reportType: "Financial", frequency: "weekly", recipients: "" });

  const addWidget = (w: string) => {
    if (customWidgets.includes(w)) return toast("Already added");
    setCustomWidgets([...customWidgets, w]);
    toast.success(`Added widget: ${w}`);
  };
  const removeWidget = (w: string) => setCustomWidgets(customWidgets.filter((x) => x !== w));

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">
      {/* Header bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); toast(`Report: ${t}`); }}
              className={`px-3 h-8 rounded-md text-[12px] whitespace-nowrap transition ${tab === t ? "bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30" : "bg-[#11161D] border border-[#222A35] text-[#8A95A5] hover:text-white"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <select
            value={range}
            onChange={(e) => { setRange(e.target.value); toast(`Range: ${e.target.value}`); }}
            className="h-8 px-3 rounded-md border border-[#222A35] bg-[#11161D] text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]"
          >
            {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={() => setFilterOpen(true)} className="h-8 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5" /> Filters {filters.region !== "All" || filters.minValue > 0 ? `· ${[filters.region !== "All" && "region", filters.minValue > 0 && "min"].filter(Boolean).length}` : ""}
          </button>
          <button onClick={() => {
            const doc = new jsPDF();
            doc.setFontSize(16);
            doc.text(`${tab} Report`, 14, 20);
            doc.setFontSize(10);
            doc.text(`Range: ${range} · Generated: ${new Date().toLocaleDateString()}`, 14, 28);
            // @ts-ignore
            doc.autoTable({
              startY: 36,
              head: [["Project", "Region", "Value", "COs", "Cycle (days)", "Health %"]],
              body: projects.map((p) => [p.p, p.region, p.value.toString(), p.cos.toString(), p.cycle.toString(), `${p.health}%`]),
              styles: { fontSize: 9, cellPadding: 2 },
              headStyles: { fillColor: [255, 107, 26] },
            });
            doc.save(`${tab}_Report_${range}_${new Date().toISOString().split("T")[0]}.pdf`);
            toast.success(`${tab} report exported as PDF`);
          }} className="h-8 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {tab === "Financial" && <FinancialPanel range={range} />}
      {tab === "Operational" && <OperationalPanel />}
      {tab === "By Project" && <ByProjectPanel filters={filters} />}
      {tab === "By Region" && <ByRegionPanel />}
      {tab === "Custom" && (
        <CustomPanel
          widgets={customWidgets}
          onAdd={addWidget}
          onRemove={removeWidget}
          available={WIDGETS}
        />
      )}
      {tab === "Scheduled" && (
        <ScheduledReportsPanel
          reports={scheduled}
          onAdd={() => setShowScheduleForm(true)}
          onToggle={async (id) => {
            const cur = scheduled.find((r) => r.id === id);
            const next = !(cur?.active);
            setScheduled((prev) => prev.map((r) => r.id === id ? { ...r, active: next } : r));
            try { await api.updateScheduledReport(id, { active: next }); } catch { /* offline: optimistic only */ }
          }}
          onDelete={async (id) => {
            setScheduled((prev) => prev.filter((r) => r.id !== id));
            try { await api.deleteScheduledReport(id); } catch { /* offline: optimistic only */ }
          }}
        />
      )}

      {/* Schedule report form modal */}
      {showScheduleForm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowScheduleForm(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[440px] bg-[#11161D] border border-[#222A35] rounded-2xl shadow-2xl">
            <div className="p-5 border-b border-[#222A35] flex items-center justify-between">
              <div className="text-[15px] text-white font-display">Schedule Report</div>
              <button onClick={() => setShowScheduleForm(false)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3 text-[12px]">
              <div>
                <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Report Name</div>
                <input value={scheduleForm.name} onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })} placeholder="e.g. Weekly Safety Digest" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Report Type</div>
                  <select value={scheduleForm.reportType} onChange={(e) => setScheduleForm({ ...scheduleForm, reportType: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white focus:outline-none focus:border-[#FF6B1A]">
                    {["Financial", "Operational", "By Project", "By Region", "Custom"].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Frequency</div>
                  <select value={scheduleForm.frequency} onChange={(e) => setScheduleForm({ ...scheduleForm, frequency: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white focus:outline-none focus:border-[#FF6B1A]">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Recipients</div>
                <input value={scheduleForm.recipients} onChange={(e) => setScheduleForm({ ...scheduleForm, recipients: e.target.value })} placeholder="email1@buildflex.com, email2@buildflex.com" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" />
              </div>
            </div>
            <div className="p-5 border-t border-[#222A35] flex gap-2">
              <button onClick={() => setShowScheduleForm(false)} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Cancel</button>
              <button onClick={async () => {
                if (!scheduleForm.name.trim() || !scheduleForm.recipients.trim()) return toast.error("Name and recipients required");
                try {
                  await api.createScheduledReport({
                    name: scheduleForm.name,
                    reportType: scheduleForm.reportType,
                    frequency: scheduleForm.frequency,
                    recipients: scheduleForm.recipients,
                    active: true,
                  });
                  await loadScheduled();
                } catch {
                  // Backend unavailable — keep an optimistic local row
                  setScheduled((prev) => [...prev, { id: `sr-${Date.now()}`, ...scheduleForm, active: true, nextRun: "Pending" }]);
                }
                setScheduleForm({ name: "", reportType: "Financial", frequency: "weekly", recipients: "" });
                setShowScheduleForm(false);
                toast.success("Scheduled report created");
              }} className="flex-1 h-10 rounded-md bg-[#FF6B1A] text-white text-[12px]">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters modal */}
      {filterOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setFilterOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[440px] bg-[#11161D] border border-[#222A35] rounded-2xl shadow-2xl">
            <div className="p-5 border-b border-[#222A35] flex items-center justify-between">
              <div className="text-[15px] text-white font-display">Report filters</div>
              <button onClick={() => setFilterOpen(false)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-2">Region</div>
                <div className="flex flex-wrap gap-1.5">
                  {["All", "PNW", "NorCal", "SoCal", "Southwest", "Mountain"].map((r) => (
                    <button key={r} onClick={() => setFilters({ ...filters, region: r })} className={`px-2.5 h-8 rounded-md text-[11px] ${filters.region === r ? "bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30" : "bg-[#0A0E14] border border-[#222A35] text-[#8A95A5]"}`}>{r}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-2 flex items-center justify-between">
                  <span>Min CO value</span><span className="text-white">{formatCompactCurrency($toKES(filters.minValue * 1000), currency)}</span>
                </div>
                <input type="range" min={0} max={500} step={10} value={filters.minValue} onChange={(e) => setFilters({ ...filters, minValue: +e.target.value })} className="w-full accent-[#FF6B1A]" />
              </div>
            </div>
            <div className="p-5 border-t border-[#222A35] flex gap-2">
              <button onClick={() => { setFilters({ region: "All", minValue: 0 }); toast("Filters cleared"); }} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Reset</button>
              <button onClick={() => { setFilterOpen(false); toast.success("Filters applied"); }} className="flex-1 h-10 rounded-md bg-[#FF6B1A] text-white text-[12px]">Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────── Financial ────────── */
function FinancialPanel({ range }: { range: string }) {
  const { currency } = useCurrency();
  const radial = [{ name: "approval", value: 87, fill: "#FF6B1A" }];
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { l: "Total CO Value", vUSD: 12.4 * 1_000_000, d: "+18.2%", up: true },
          { l: "Approval Rate", v: "87.4%", d: "+2.1pp", up: true },
          { l: "Median Cycle", v: "3.4d", d: "-1.1d", up: false, good: true },
          { l: "Rework Rate", v: "4.8%", d: "-0.7pp", up: false, good: true },
        ].map((k) => (
          <div key={k.l} className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="text-[11px] text-[#8A95A5]">{k.l} · {range}</div>
            <div className="text-[24px] sm:text-[28px] text-white mt-1 font-display">{(k as any).vUSD ? formatCompactCurrency($toKES((k as any).vUSD), currency) : k.v}</div>
            <div className={`text-[11px] mt-1 flex items-center gap-1 ${k.good || k.up ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
              {k.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />} {k.d}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
        <div className="lg:col-span-2 rounded-xl border border-[#222A35] bg-[#11161D] p-5">
          <div className="text-[13px] text-white font-display">CO Volume by Status</div>
          <div className="text-[11px] text-[#8A95A5]">Millions · 8 months</div>
          <div className="h-[240px] mt-3">
            <ResponsiveContainer>
              <BarChart data={monthly}>
                <CartesianGrid stroke="#222A35" vertical={false} />
                <XAxis dataKey="m" stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#0A0E14", border: "1px solid #222A35", borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="approved" stackId="a" fill="#FF6B1A" />
                <Bar dataKey="pending" stackId="a" fill="#F5A623" />
                <Bar dataKey="rejected" stackId="a" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
          <div className="text-[13px] text-white font-display">Approval Rate</div>
          <div className="h-[200px] mt-4 relative">
            <ResponsiveContainer>
              <RadialBarChart innerRadius="70%" outerRadius="100%" data={radial} startAngle={90} endAngle={-270}>
                <RadialBar dataKey="value" cornerRadius={20} fill="#FF6B1A" background={{ fill: "#222A35" }} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[32px] text-white font-display">87%</div>
              <div className="text-[11px] text-[#FF6B1A]">+2.1pp</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ────────── Operational ────────── */
function OperationalPanel() {
  const slas = [
    { stage: "Field draft → PM Review", target: "1d", actual: "0.8d", state: "ok" },
    { stage: "PM Review → Cost validation", target: "2d", actual: "1.4d", state: "ok" },
    { stage: "Cost validation → Exec", target: "1d", actual: "1.2d", state: "warn" },
    { stage: "Exec → Owner submission", target: "0.5d", actual: "0.3d", state: "ok" },
    { stage: "Owner decision", target: "3d", actual: "5.8d", state: "bad" },
  ];
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { l: "Median cycle", v: "3.4d", c: "#22C55E" },
          { l: "SLA breaches", v: "12", c: "#EF4444" },
          { l: "Auto-routed", v: "84%", c: "#FF6B1A" },
          { l: "Hand-offs / CO", v: "2.7", c: "#8A95A5" },
        ].map((k) => (
          <div key={k.l} className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="text-[11px] text-[#8A95A5]">{k.l}</div>
            <div className="text-[24px] sm:text-[28px] mt-1 font-display" style={{ color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
          <div className="text-[13px] text-white font-display">Cycle Time Trend</div>
          <div className="text-[11px] text-[#8A95A5]">Median days · 8 weeks</div>
          <div className="h-[240px] mt-3">
            <ResponsiveContainer>
              <LineChart data={velocity}>
                <CartesianGrid stroke="#222A35" vertical={false} />
                <XAxis dataKey="d" stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#0A0E14", border: "1px solid #222A35", borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="v" stroke="#FF6B1A" strokeWidth={2.5} dot={{ fill: "#FF6B1A", r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
          <div className="text-[13px] text-white font-display">SLA Adherence by Stage</div>
          <div className="text-[11px] text-[#8A95A5] mb-3">Target vs actual cycle time</div>
          <div className="space-y-3">
            {slas.map((s) => (
              <div key={s.stage}>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-white">{s.stage}</span>
                  <span className={s.state === "ok" ? "text-[#22C55E]" : s.state === "warn" ? "text-[#F5A623]" : "text-[#EF4444]"}>{s.actual} / {s.target}</span>
                </div>
                <div className="h-1.5 bg-[#222A35] rounded-full overflow-hidden">
                  <div className="h-full" style={{ width: s.state === "ok" ? "60%" : s.state === "warn" ? "85%" : "100%", background: s.state === "ok" ? "#22C55E" : s.state === "warn" ? "#F5A623" : "#EF4444" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5 mt-5">
        <div className="text-[13px] text-white font-display">Triggers Breakdown</div>
        <div className="text-[11px] text-[#8A95A5]">Why change orders happen</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div className="h-[200px] relative">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={triggers} dataKey="v" innerRadius={55} outerRadius={80} paddingAngle={2}>
                  {triggers.map((t) => <Cell key={t.name} fill={t.c} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Total</div>
              <div className="text-[22px] text-white font-display">247</div>
            </div>
          </div>
          <div className="space-y-1.5">
            {triggers.map((t) => (
              <div key={t.name} className="flex items-center justify-between text-[12px] p-2 rounded hover:bg-[#161C24]">
                <span className="flex items-center gap-2 text-white"><span className="w-2 h-2 rounded-sm" style={{ background: t.c }} />{t.name}</span>
                <span className="text-[#8A95A5]">{t.v}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ────────── By Project ────────── */
function ByProjectPanel({ filters }: { filters: { region: string; minValue: number } }) {
  const { currency } = useCurrency();
  const rows = projects
    .filter((p) => filters.region === "All" || p.region === filters.region)
    .filter((p) => p.value >= filters.minValue)
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        <div className="p-5 border-b border-[#222A35] flex items-center justify-between">
          <div>
            <div className="text-[13px] text-white font-display">Project Leaderboard</div>
            <div className="text-[11px] text-[#8A95A5]">CO exposure ranked · {rows.length} project{rows.length !== 1 ? "s" : ""} matching filters</div>
          </div>
          <button onClick={() => {
            const data = rows.map((p) => ({ Project: p.p, Region: p.region, "Value": p.value, COs: p.cos, "Cycle (days)": p.cycle, "Health %": p.health }));
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Leaderboard");
            XLSX.writeFile(wb, `Leaderboard_${new Date().toISOString().split("T")[0]}.xlsx`);
            toast.success("Leaderboard exported as Excel");
          }} className="text-[11px] text-[#FF6B1A] hover:underline">Export Excel</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                <th className="text-left px-5 py-2.5">Project</th>
                <th className="text-left px-3 py-2.5">Region</th>
                <th className="text-right px-3 py-2.5">CO Value</th>
                <th className="text-right px-3 py-2.5">COs</th>
                <th className="text-right px-3 py-2.5">Cycle</th>
                <th className="text-right px-5 py-2.5">Health</th>
              </tr>
            </thead>
            <tbody className="text-[12px]">
              {rows.map((p) => (
                <tr key={p.p} onClick={() => toast(`Drilling into ${p.p}`)} className="border-t border-[#222A35] hover:bg-[#161C24] cursor-pointer">
                  <td className="px-5 py-3 text-white">{p.p}</td>
                  <td className="px-3 py-3 text-[#8A95A5]">{p.region}</td>
                  <td className="px-3 py-3 text-right text-[#FF6B1A]">{formatCurrency($toKES(p.value * 1000), currency)}</td>
                  <td className="px-3 py-3 text-right text-white">{p.cos}</td>
                  <td className="px-3 py-3 text-right text-[#8A95A5]">{p.cycle}d</td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-2 justify-end">
                      <div className="w-16 h-1.5 bg-[#222A35] rounded-full overflow-hidden">
                        <div className="h-full" style={{ width: `${p.health}%`, background: p.health > 90 ? "#22C55E" : p.health > 75 ? "#F5A623" : "#EF4444" }} />
                      </div>
                      <span className="text-white text-[11px]">{p.health}</span>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-[#5B6675] text-[12px]">No projects match the filters</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
          <div className="text-[13px] text-white font-display">CO Value · per project</div>
          <div className="h-[260px] mt-3">
            <ResponsiveContainer>
              <BarChart data={rows} layout="vertical">
                <CartesianGrid stroke="#222A35" horizontal={false} />
                <XAxis type="number" stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis dataKey="p" type="category" stroke="#5B6675" fontSize={10} width={100} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#0A0E14", border: "1px solid #222A35", borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="value" fill="#FF6B1A" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
          <div className="text-[13px] text-white font-display">Cycle time vs Health</div>
          <div className="text-[11px] text-[#8A95A5] mb-3">Lower cycle correlates with higher health</div>
          <div className="space-y-2">
            {rows.map((p) => (
              <div key={p.p} className="flex items-center gap-3 p-2 rounded hover:bg-[#0A0E14]">
                <Building2 className="w-3.5 h-3.5 text-[#8A95A5]" />
                <div className="flex-1 text-[12px] text-white truncate">{p.p}</div>
                <div className="text-[11px] text-[#FF6B1A] w-12 text-right">{p.cycle}d</div>
                <div className="text-[11px] text-white w-10 text-right">{p.health}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ────────── By Region ────────── */
function ByRegionPanel() {
  const { currency } = useCurrency();
  const total = regions.reduce((s, r) => s + r.v, 0);
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-[#222A35] bg-[#11161D] p-5">
          <div className="text-[13px] text-white font-display">Regional CO Exposure</div>
          <div className="text-[11px] text-[#8A95A5]">Millions · YTD</div>
          <div className="h-[280px] mt-3">
            <ResponsiveContainer>
              <BarChart data={regions}>
                <CartesianGrid stroke="#222A35" vertical={false} />
                <XAxis dataKey="r" stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis stroke="#5B6675" fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#0A0E14", border: "1px solid #222A35", borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="v" radius={[4, 4, 0, 0]}>
                  {regions.map((r) => <Cell key={r.r} fill={r.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
          <div className="text-[13px] text-white font-display">Share of Total</div>
          <div className="text-[11px] text-[#8A95A5] mb-3">{formatCompactCurrency($toKES(total * 1_000_000), currency)} across {regions.reduce((s, r) => s + r.projects, 0)} projects</div>
          <div className="space-y-2.5">
            {regions.map((r) => (
              <button key={r.r} onClick={() => toast(`Drill into ${r.r}`)} className="w-full text-left p-2 rounded hover:bg-[#0A0E14]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="flex items-center gap-2 text-[12px] text-white"><MapPin className="w-3 h-3" style={{ color: r.color }} />{r.r}</span>
                  <span className="text-[11px] text-white">{formatCompactCurrency($toKES(r.v * 1_000_000), currency)}</span>
                </div>
                <div className="h-1.5 bg-[#222A35] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(r.v / total) * 100}%`, background: r.color }} />
                </div>
                <div className="text-[10px] text-[#5B6675] mt-1">{r.projects} project{r.projects !== 1 ? "s" : ""}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5 mt-5">
        <div className="text-[13px] text-white font-display">Regional Health Map</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
          {regions.map((r) => (
            <button key={r.r} onClick={() => toast(`${r.r} · ${r.projects} projects`)} className="p-4 rounded-lg border border-[#222A35] bg-[#0A0E14] hover:border-[#FF6B1A]/50 text-left">
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: `${r.color}25`, color: r.color }}>
                <MapPin className="w-4 h-4" />
              </div>
              <div className="text-[12px] text-white mt-2 font-display truncate">{r.r}</div>
              <div className="text-[18px] font-display mt-0.5" style={{ color: r.color }}>{formatCompactCurrency($toKES(r.v * 1_000_000), currency)}</div>
              <div className="text-[10px] text-[#5B6675]">{r.projects} project{r.projects !== 1 ? "s" : ""}</div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ────────── Custom ────────── */
function CustomPanel({ widgets, onAdd, onRemove, available }: { widgets: string[]; onAdd: (w: string) => void; onRemove: (w: string) => void; available: string[] }) {
  const { currency } = useCurrency();
  return (
    <>
      <div className="rounded-xl border border-dashed border-[#222A35] bg-[#11161D]/50 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[13px] text-white font-display">Custom report builder</div>
            <div className="text-[11px] text-[#8A95A5]">Click widgets below to add them. Drag to reorder.</div>
          </div>
          <button onClick={() => toast.success("Report saved as template")} className="text-[11px] text-[#FF6B1A] hover:underline">Save template</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {available.map((w) => {
            const on = widgets.includes(w);
            return (
              <button
                key={w}
                onClick={() => on ? onRemove(w) : onAdd(w)}
                className={`px-3 h-8 rounded-md text-[11px] flex items-center gap-1.5 ${on ? "bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30" : "bg-[#0A0E14] border border-[#222A35] text-[#8A95A5] hover:text-white"}`}
              >
                {on ? <CheckCircle2 className="w-3 h-3" /> : <Plus className="w-3 h-3" />} {w}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
        {widgets.map((w) => (
          <div key={w} className="rounded-xl border border-[#222A35] bg-[#11161D] p-5 relative group">
            <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition">
              <button className="w-6 h-6 rounded bg-[#222A35] text-[#8A95A5] flex items-center justify-center cursor-grab"><GripVertical className="w-3 h-3" /></button>
              <button onClick={() => onRemove(w)} className="w-6 h-6 rounded bg-[#222A35] text-[#8A95A5] hover:text-[#EF4444] flex items-center justify-center"><X className="w-3 h-3" /></button>
            </div>
            <div className="text-[12px] text-[#5B6675] uppercase tracking-wider">{w}</div>
            <div className="h-[140px] mt-3 flex items-center justify-center">
              {w.includes("Revenue") && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={velocity}>
                    <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FF6B1A" stopOpacity={0.4} /><stop offset="100%" stopColor="#FF6B1A" stopOpacity={0} /></linearGradient></defs>
                    <Area type="monotone" dataKey="v" stroke="#FF6B1A" fill="url(#cg)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
              {w.includes("Approval") && <div className="text-[42px] text-[#FF6B1A] font-display">87%</div>}
              {w.includes("Cycle") && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={velocity}><Line dataKey="v" stroke="#FF6B1A" strokeWidth={2.5} dot={false} /></LineChart>
                </ResponsiveContainer>
              )}
              {w.includes("Triggers") && (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={triggers} dataKey="v" innerRadius={40} outerRadius={60}>{triggers.map((t) => <Cell key={t.name} fill={t.c} />)}</Pie></PieChart>
                </ResponsiveContainer>
              )}
              {w.includes("Bottlenecks") && <div className="text-center"><AlertTriangle className="w-6 h-6 text-[#F5A623] mx-auto" /><div className="text-[22px] text-white mt-2 font-display">5.8d</div><div className="text-[10px] text-[#5B6675]">owner delay</div></div>}
              {w.includes("Region") && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={regions}><Bar dataKey="v" radius={[4, 4, 0, 0]}>{regions.map((r) => <Cell key={r.r} fill={r.color} />)}</Bar></BarChart>
                </ResponsiveContainer>
              )}
              {w.includes("Top projects") && <div className="text-center"><Building2 className="w-6 h-6 text-[#FF6B1A] mx-auto" /><div className="text-[14px] text-white mt-2">Harborfront Tower</div><div className="text-[10px] text-[#5B6675]">{formatCompactCurrency($toKES(2.4 * 1_000_000), currency)} exposure</div></div>}
              {w.includes("SLA") && <div className="text-center"><Clock className="w-6 h-6 text-[#22C55E] mx-auto" /><div className="text-[22px] text-white mt-2 font-display">84%</div><div className="text-[10px] text-[#5B6675]">on-SLA</div></div>}
            </div>
          </div>
        ))}
        {widgets.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-[#222A35] py-16 text-center">
            <Plus className="w-6 h-6 text-[#5B6675] mx-auto" />
            <div className="text-[13px] text-white mt-2 font-display">Empty report</div>
            <div className="text-[11px] text-[#8A95A5]">Add widgets from the picker above</div>
          </div>
        )}
      </div>
    </>
  );
}

/* ────────── Scheduled Reports ────────── */
function ScheduledReportsPanel({ reports, onAdd, onToggle, onDelete }: { reports: { id: string; name: string; reportType: string; frequency: string; recipients: string; active: boolean; nextRun: string }[]; onAdd: () => void; onToggle: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-[13px] text-white font-display">Scheduled Reports</div>
          <div className="text-[11px] text-[#8A95A5]">Auto-generate and email reports on a recurring basis</div>
        </div>
        <button onClick={onAdd} className="h-9 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5 shrink-0"><Plus className="w-3.5 h-3.5" /> New Schedule</button>
      </div>
      <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-3 py-2.5">Type</th>
                <th className="text-left px-3 py-2.5">Frequency</th>
                <th className="text-left px-3 py-2.5">Recipients</th>
                <th className="text-left px-3 py-2.5">Next Run</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="border-t border-[#222A35] hover:bg-[#161C24]">
                  <td className="px-4 py-2.5 text-white font-display">{r.name}</td>
                  <td className="px-3 py-2.5"><span className="px-1.5 py-0.5 rounded text-[10px] bg-[#222A35] text-[#8A95A5]">{r.reportType}</span></td>
                  <td className="px-3 py-2.5 text-[#8A95A5] flex items-center gap-1"><Repeat className="w-3 h-3" />{r.frequency}</td>
                  <td className="px-3 py-2.5 text-[#8A95A5] truncate max-w-[160px]">{r.recipients}</td>
                  <td className="px-3 py-2.5 text-[#8A95A5]">{r.nextRun}</td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => onToggle(r.id)} className={`px-2 py-0.5 rounded-full text-[10px] border ${r.active ? "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30" : "bg-[#5B6675]/15 text-[#5B6675] border-[#5B6675]/30"}`}>
                      {r.active ? "Active" : "Paused"}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => onDelete(r.id)} className="text-[#8A95A5] hover:text-[#EF4444]"><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
              {reports.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-[11px] text-[#5B6675]">No scheduled reports</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 space-y-2">
        <div className="text-[12px] text-white font-display">Push Notification Settings</div>
        <div className="text-[11px] text-[#8A95A5]">When a scheduled report is generated, recipients can receive push notifications to their mobile devices.</div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-[11px] text-[#8A95A5]">
          <div className="flex items-center gap-2"><Bell className="w-3.5 h-3.5 text-[#FF6B1A]" /> Enable push notifications for scheduled reports</div>
          <button onClick={() => toast.success("Push notifications enabled for scheduled reports")} className="sm:ml-auto px-2 py-1 rounded text-[10px] bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30 shrink-0">Enable</button>
        </div>
      </div>
    </div>
  );
}
