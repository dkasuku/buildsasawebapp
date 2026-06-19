// ============================================================================
// Punch List (Procore-inspired, original UI/code).
// Table + filters + bulk actions · multi-assignee create/edit form ·
// detail panel (workflow, comments, attachments, activity) · CSV/PDF export.
// ============================================================================

import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import {
  Plus, Search, Filter, Download, X, CheckSquare, Square, MapPin, Paperclip,
  MessageSquare, Clock, AlertTriangle, CircleDot, CheckCircle2, Loader2, Trash2,
  ImageIcon, Send, ChevronDown, Users,
} from "lucide-react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import { TEAM_MEMBERS } from "./team-data";
import { useTeam, resolveName } from "./useTeam";
import api from "../../services/api";
import { ImageLightbox } from "./ImageLightbox";

/* ─────────────────────────── Types ─────────────────────────── */
export type PunchStatus = "open" | "in_progress" | "ready_for_review" | "resolved" | "closed" | "rejected";
export interface PunchItem {
  id: string; code?: string; projectId: string;
  title?: string; desc?: string; description?: string; area?: string; location?: string;
  category?: string; trade?: string; priority?: string; status: PunchStatus;
  assignees?: string;            // JSON array of userIds
  punchManagerId?: string; finalApproverId?: string;
  dueDate?: string; reference?: string; costCode?: string;
  costImpact?: string; scheduleImpact?: string; isPrivate?: boolean;
  distribution?: string; linkedDrawingId?: string; drawingCoordinates?: string;
  photos?: string; createdAt?: string; updatedAt?: string;
}

/* ─────────────────────────── Meta / helpers ─────────────────────────── */
const STATUS_META: Record<PunchStatus, { label: string; cls: string; pin: string }> = {
  open:             { label: "Open",            cls: "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30", pin: "#EF4444" },
  in_progress:      { label: "In Progress",     cls: "bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/30", pin: "#3B82F6" },
  ready_for_review: { label: "Ready for Review", cls: "bg-[#A855F7]/15 text-[#A855F7] border-[#A855F7]/30", pin: "#A855F7" },
  resolved:         { label: "Resolved",        cls: "bg-[#F5A623]/15 text-[#F5A623] border-[#F5A623]/30", pin: "#F5A623" },
  closed:           { label: "Closed",          cls: "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30", pin: "#22C55E" },
  rejected:         { label: "Rejected",        cls: "bg-[#5B6675]/15 text-[#8A95A5] border-[#5B6675]/30", pin: "#8A95A5" },
};
const PRIORITY_CLS: Record<string, string> = { low: "text-[#8A95A5]", medium: "text-[#F5A623]", high: "text-[#EF4444]" };
const CATEGORIES = ["architectural", "mep", "finishes", "structural", "civil", "other"];
const TRADES = ["General", "Electrical", "Plumbing", "HVAC", "Carpentry", "Painting", "Masonry", "Concrete", "Roofing"];
const IMPACT = ["yes", "yes_unknown", "no", "tbd", "na"];
const IMPACT_LABEL: Record<string, string> = { yes: "Yes", yes_unknown: "Yes (unknown)", no: "No", tbd: "TBD", na: "N/A" };

const parseArr = (s?: string): string[] => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
const nameOf = (id: string) => resolveName(id);

// The app Role → punch workflow role used for transition permission checks.
function punchRoleFor(role: Role): "manager" | "assignee" | "approver" | "creator" {
  if (["Contractor", "Project Manager", "Executive", "Owner"].includes(role)) return "manager";
  return "assignee";
}

/* ─────────────────────────── Export utilities ─────────────────────────── */
// 🔌 Swap these for a real CSV/PDF service later; signatures stay the same.
function exportCSV(items: PunchItem[]) {
  const cols = ["Code", "Title", "Location", "Trade", "Priority", "Status", "Assignees", "Due", "Cost Impact", "Schedule Impact"];
  const rows = items.map((p) => [
    p.code, p.title || p.desc, p.location || p.area, p.trade, p.priority, STATUS_META[p.status]?.label,
    parseArr(p.assignees).map(nameOf).join("; "), p.dueDate, IMPACT_LABEL[p.costImpact || "tbd"], IMPACT_LABEL[p.scheduleImpact || "tbd"],
  ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
  const blob = new Blob([[cols.join(","), ...rows].join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `punch-list-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  toast.success("Punch list exported as CSV");
}
function exportLogPDF(items: PunchItem[]) {
  const doc = new jsPDF(); doc.setFontSize(15); doc.text("Punch List Log", 14, 18);
  doc.setFontSize(9); doc.text(`Generated ${new Date().toLocaleString()} · ${items.length} items`, 14, 25);
  let y = 34;
  items.forEach((p) => {
    if (y > 275) { doc.addPage(); y = 18; }
    doc.setFontSize(10); doc.setTextColor(20); doc.text(`${p.code || ""}  ${p.title || p.desc || ""}`.slice(0, 90), 14, y);
    doc.setFontSize(8); doc.setTextColor(110);
    doc.text(`${STATUS_META[p.status]?.label} · ${p.priority || ""} · ${p.trade || ""} · ${p.location || p.area || ""} · due ${p.dueDate || "—"} · ${parseArr(p.assignees).map(nameOf).join(", ") || "Unassigned"}`.slice(0, 120), 14, y + 5);
    y += 12;
  });
  doc.save(`punch-list-${new Date().toISOString().slice(0, 10)}.pdf`);
  toast.success("Punch list exported as PDF");
}
function exportItemPDF(p: PunchItem, comments: any[], activity: any[]) {
  const doc = new jsPDF(); doc.setFontSize(15); doc.text(`Punch Item ${p.code || ""}`, 14, 18);
  doc.setFontSize(11); doc.text(p.title || p.desc || "", 14, 27);
  doc.setFontSize(9); doc.setTextColor(90);
  const lines = [
    `Status: ${STATUS_META[p.status]?.label}   Priority: ${p.priority}`,
    `Location: ${p.location || p.area || "—"}   Trade: ${p.trade || "—"}   Category: ${p.category || "—"}`,
    `Assignees: ${parseArr(p.assignees).map(nameOf).join(", ") || "Unassigned"}`,
    `Due: ${p.dueDate || "—"}   Cost impact: ${IMPACT_LABEL[p.costImpact || "tbd"]}   Schedule impact: ${IMPACT_LABEL[p.scheduleImpact || "tbd"]}`,
    `Reference: ${p.reference || "—"}   Cost code: ${p.costCode || "—"}`,
  ];
  let y = 37; lines.forEach((l) => { doc.text(l, 14, y); y += 6; });
  doc.text(`Description: ${p.description || p.desc || "—"}`, 14, y + 2); y += 12;
  doc.setTextColor(20); doc.text("Comments", 14, y); y += 6; doc.setTextColor(90);
  comments.slice(0, 12).forEach((c) => { doc.text(`• ${nameOf(c.authorId)}: ${c.text}`.slice(0, 110), 16, y); y += 5; });
  y += 4; doc.setTextColor(20); doc.text("Activity", 14, y); y += 6; doc.setTextColor(90);
  activity.slice(0, 10).forEach((a) => { doc.text(`• ${a.actionType}${a.after ? " → " + a.after : ""}`.slice(0, 110), 16, y); y += 5; });
  doc.setTextColor(150); doc.text("[ Drawing snapshot placeholder — pin location ]", 14, y + 6);
  doc.save(`punch-${p.code || p.id}.pdf`);
  toast.success("Item exported as PDF");
}

/* ─────────────────────────── Multi-assignee selector ─────────────────────────── */
function MultiAssign({ value, onChange, label = "Assignees" }: { value: string[]; onChange: (v: string[]) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const team = useTeam();
  const people = team.length ? team : TEAM_MEMBERS;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="relative">
      <div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">{label} (multiple allowed)</div>
      <button type="button" onClick={() => setOpen(!open)} className="w-full min-h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 py-1.5 text-left flex flex-wrap gap-1 items-center">
        {value.length === 0 && <span className="text-[12px] text-[#5B6675]">Select one or more…</span>}
        {value.map((id) => (
          <span key={id} className="text-[11px] px-1.5 py-0.5 rounded bg-[#FF6B1A]/15 text-[#FF6B1A] flex items-center gap-1">{nameOf(id)}<span onClick={(e) => { e.stopPropagation(); toggle(id); }}><X className="w-3 h-3" /></span></span>
        ))}
        <ChevronDown className="w-3.5 h-3.5 text-[#5B6675] ml-auto" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded-md border border-[#222A35] bg-[#11161D] shadow-xl py-1">
            {people.length === 0 && <div className="px-3 py-2 text-[11px] text-[#5B6675]">No teammates yet — invite people on the Team page.</div>}
            {people.map((m) => (
              <button key={m.id} type="button" onClick={() => toggle(m.id)} className="w-full px-3 py-1.5 text-left text-[12px] flex items-center gap-2 hover:bg-[#161C24]">
                {value.includes(m.id) ? <CheckSquare className="w-3.5 h-3.5 text-[#FF6B1A]" /> : <Square className="w-3.5 h-3.5 text-[#5B6675]" />}
                <span className="text-white">{m.name}</span><span className="text-[10px] text-[#5B6675] ml-auto">{m.role}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── Main ─────────────────────────── */
export default function PunchListPro({ role }: { role: Role }) {
  const perms = ROLES[role];
  const team = useTeam();
  const people = team.length ? team : TEAM_MEMBERS;
  const [items, setItems] = useState<PunchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [filters, setFilters] = useState({ projectId: "", status: "", trade: "", priority: "", assignee: "", q: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState<null | PunchItem>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      for (const k of ["projectId", "status", "trade", "priority", "assignee", "q"]) { const v = (filters as any)[k]; if (v) params[k] = v; }
      setItems(await api.listPunch(params));
    } catch { /* offline */ setItems([]); }
    setLoading(false);
  };
  useEffect(() => { api.getProjects().then((p) => setProjects(p.map((x) => ({ id: x.id, name: x.name })))).catch(() => {}); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.status, filters.trade, filters.priority, filters.assignee, filters.projectId]);

  const filtered = useMemo(() => {
    const q = filters.q.toLowerCase();
    return q ? items.filter((p) => `${p.title} ${p.desc} ${p.code} ${p.reference}`.toLowerCase().includes(q)) : items;
  }, [items, filters.q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    items.forEach((p) => { c[p.status] = (c[p.status] || 0) + 1; });
    return c;
  }, [items]);

  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulkStatus = async (status: PunchStatus) => {
    const pr = punchRoleFor(role);
    await Promise.all([...selected].map((id) => api.setPunchStatus(id, status, pr).catch(() => {})));
    toast.success(`Updated ${selected.size} item(s)`); setSelected(new Set()); load();
  };
  const bulkAssign = async (ids: string[]) => {
    await Promise.all([...selected].map((id) => api.updatePunchItem(id, { assignees: ids }).catch(() => {})));
    toast.success(`Reassigned ${selected.size} item(s)`); setSelected(new Set()); load();
  };

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-4">
      {/* status summary */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {(Object.keys(STATUS_META) as PunchStatus[]).map((s) => (
          <div key={s} className="rounded-lg border border-[#222A35] bg-[#11161D] p-2.5 text-left">
            <div className="text-[18px] text-white font-display">{counts[s] || 0}</div>
            <div className="text-[10px] text-[#8A95A5]">{STATUS_META[s].label}</div>
          </div>
        ))}
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B6675]" />
          <input value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="Search title, description, code, reference…" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg pl-9 pr-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
        </div>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white"><option value="">All statuses</option>{(Object.keys(STATUS_META) as PunchStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select>
        <select value={filters.trade} onChange={(e) => setFilters((f) => ({ ...f, trade: e.target.value }))} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white"><option value="">All trades</option>{TRADES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white"><option value="">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        <select value={filters.assignee} onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white"><option value="">Any assignee</option>{people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <button onClick={() => exportCSV(filtered)} className="h-9 px-2.5 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> CSV</button>
        <button onClick={() => exportLogPDF(filtered)} className="h-9 px-2.5 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> PDF</button>
        <button onClick={() => setShowForm({ id: "", projectId: projects[0]?.id || "", status: "open", priority: "medium" } as PunchItem)} className="h-9 px-4 bg-[#FF6B1A] text-white rounded-lg text-[12px] flex items-center gap-1.5 hover:bg-[#FF7E33]"><Plus className="w-3.5 h-3.5" /> Create Punch Item</button>
      </div>

      {/* bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-[#161C24] border border-[#222A35]">
          <span className="text-[12px] text-white">{selected.size} selected</span>
          <select onChange={(e) => e.target.value && bulkStatus(e.target.value as PunchStatus)} defaultValue="" className="h-8 bg-[#0A0E14] border border-[#222A35] rounded px-2 text-[11px] text-white"><option value="" disabled>Set status…</option>{(Object.keys(STATUS_META) as PunchStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select>
          <MiniAssignBulk onApply={bulkAssign} />
          <button onClick={() => setSelected(new Set())} className="text-[11px] text-[#8A95A5] hover:text-white ml-auto">Clear</button>
        </div>
      )}

      {/* table — tablet & desktop */}
      <div className="hidden sm:block rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider border-b border-[#222A35]">
                <th className="w-8 px-3 py-2.5"></th>
                <th className="text-left px-3 py-2.5">Code</th>
                <th className="text-left px-3 py-2.5">Title</th>
                <th className="text-left px-3 py-2.5">Location</th>
                <th className="text-left px-3 py-2.5">Trade</th>
                <th className="text-left px-3 py-2.5">Assignees</th>
                <th className="text-left px-3 py-2.5">Priority</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-left px-3 py-2.5">Due</th>
                <th className="text-center px-3 py-2.5">Impact</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} className="text-center py-10 text-[#5B6675]"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={10} className="text-center py-10 text-[#5B6675]">No punch items. Create one to get started.</td></tr>}
              {!loading && filtered.map((p) => {
                const M = STATUS_META[p.status] || STATUS_META.open; const asg = parseArr(p.assignees);
                return (
                  <tr key={p.id} className="border-b border-[#222A35] hover:bg-[#161C24] cursor-pointer" onClick={() => setDetailId(p.id)}>
                    <td className="px-3 py-2.5" onClick={(e) => { e.stopPropagation(); toggleSel(p.id); }}>{selected.has(p.id) ? <CheckSquare className="w-4 h-4 text-[#FF6B1A]" /> : <Square className="w-4 h-4 text-[#5B6675]" />}</td>
                    <td className="px-3 py-2.5 font-mono text-[#8A95A5]">{p.code}</td>
                    <td className="px-3 py-2.5 text-white max-w-[220px] truncate">{p.title || p.desc}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{p.location || p.area || "—"}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{p.trade || "—"}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5] truncate max-w-[160px]">{asg.length ? asg.map(nameOf).join(", ") : <span className="text-[#5B6675]">Unassigned</span>}</td>
                    <td className={`px-3 py-2.5 capitalize ${PRIORITY_CLS[p.priority || "medium"]}`}>{p.priority}</td>
                    <td className="px-3 py-2.5"><span className={`text-[10px] px-2 py-1 rounded-full border ${M.cls}`}>{M.label}</span></td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{p.dueDate || "—"}</td>
                    <td className="px-3 py-2.5 text-center">{(p.costImpact === "yes" || p.scheduleImpact === "yes") && <AlertTriangle className="w-3.5 h-3.5 text-[#F5A623] inline" />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* cards — phones */}
      <div className="sm:hidden space-y-2">
        {loading && <div className="text-center py-10 text-[#5B6675] text-[12px]"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading…</div>}
        {!loading && filtered.length === 0 && <div className="text-center py-10 text-[#5B6675] text-[12px] rounded-xl border border-[#222A35] bg-[#11161D]">No punch items. Create one to get started.</div>}
        {!loading && filtered.map((p) => {
          const M = STATUS_META[p.status] || STATUS_META.open; const asg = parseArr(p.assignees);
          return (
            <div key={p.id} onClick={() => setDetailId(p.id)} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3 active:bg-[#161C24]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button onClick={(e) => { e.stopPropagation(); toggleSel(p.id); }} className="shrink-0">{selected.has(p.id) ? <CheckSquare className="w-4 h-4 text-[#FF6B1A]" /> : <Square className="w-4 h-4 text-[#5B6675]" />}</button>
                  <span className="font-mono text-[11px] text-[#8A95A5] truncate">{p.code}</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${M.cls}`}>{M.label}</span>
              </div>
              <div className="text-[13px] text-white mt-1.5">{p.title || p.desc}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-[#8A95A5]">
                <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{p.location || p.area || "—"}</span>
                <span>{p.trade || "—"}</span>
                <span className={`capitalize ${PRIORITY_CLS[p.priority || "medium"]}`}>{p.priority}</span>
                {p.dueDate && <span>Due {p.dueDate}</span>}
                {(p.costImpact === "yes" || p.scheduleImpact === "yes") && <span className="inline-flex items-center gap-1 text-[#F5A623]"><AlertTriangle className="w-3 h-3" /> Impact</span>}
              </div>
              <div className="text-[11px] mt-1.5 truncate">{asg.length ? <span className="text-[#C2CAD6]">{asg.map(nameOf).join(", ")}</span> : <span className="text-[#5B6675]">Unassigned</span>}</div>
            </div>
          );
        })}
      </div>

      {showForm && <PunchForm role={role} projects={projects} initial={showForm} onClose={() => setShowForm(null)} onSaved={() => { setShowForm(null); load(); }} />}
      {detailId && <PunchDetail id={detailId} role={role} onClose={() => setDetailId(null)} onChange={load} />}
    </div>
  );
}

function MiniAssignBulk({ onApply }: { onApply: (ids: string[]) => void }) {
  const [ids, setIds] = useState<string[]>([]);
  const team = useTeam();
  const people = team.length ? team : TEAM_MEMBERS;
  return (
    <div className="flex items-center gap-1">
      <select onChange={(e) => { if (e.target.value && !ids.includes(e.target.value)) setIds([...ids, e.target.value]); }} defaultValue="" className="h-8 bg-[#0A0E14] border border-[#222A35] rounded px-2 text-[11px] text-white"><option value="" disabled>Reassign to…</option>{people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      {ids.length > 0 && <button onClick={() => { onApply(ids); setIds([]); }} className="text-[11px] px-2 py-1 rounded bg-[#FF6B1A]/15 text-[#FF6B1A]">Apply {ids.length}</button>}
    </div>
  );
}

/* ─────────────────────────── Create / edit form ─────────────────────────── */
export function PunchForm({ role, projects, initial, onClose, onSaved }: { role: Role; projects: { id: string; name: string }[]; initial: PunchItem; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({
    projectId: initial.projectId || projects[0]?.id || "", title: initial.title || "", description: initial.description || initial.desc || "",
    location: initial.location || "", category: initial.category || "architectural", trade: initial.trade || "General",
    priority: initial.priority || "medium", assignees: parseArr(initial.assignees), punchManagerId: initial.punchManagerId || "",
    finalApproverId: initial.finalApproverId || "", distribution: parseArr(initial.distribution), dueDate: initial.dueDate || "",
    reference: initial.reference || "", costCode: initial.costCode || "", costImpact: initial.costImpact || "tbd",
    scheduleImpact: initial.scheduleImpact || "tbd", isPrivate: initial.isPrivate || false,
    linkedDrawingId: initial.linkedDrawingId || undefined, drawingCoordinates: initial.drawingCoordinates || undefined,
  });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);
  const team = useTeam();
  const people = team.length ? team : TEAM_MEMBERS;

  const save = async (again: boolean) => {
    if (!f.title.trim()) return toast.error("Title is required");
    if (!f.projectId) return toast.error("Pick a project");
    setSaving(true);
    try {
      const payload = { ...f, desc: f.description, area: f.location };
      if (initial.id) await api.updatePunchItem(initial.id, payload); else await api.createPunchItem(payload);
      toast.success(initial.id ? "Punch item updated" : "Punch item created");
      // 🔌 NOTIFY: send to assignees + distribution list (email/push) here.
      if (again && !initial.id) { setF((p: any) => ({ ...p, title: "", description: "", location: "" })); }
      else onSaved();
    } catch (e: any) { toast.error(e.message || "Save failed"); }
    setSaving(false);
  };

  const Field = ({ label, children }: { label: string; children: any }) => (
    <div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">{label}</div>{children}</div>
  );
  const inputCls = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]";

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between sticky top-0 bg-[#11161D]">
          <div className="text-[15px] text-white font-display">{initial.id ? "Edit punch item" : "Create punch item"}</div>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Title *"><input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Short summary of the deficiency" className={inputCls} /></Field>
          <Field label="Description"><textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-2 py-1.5 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A] resize-none" /></Field>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Project"><select value={f.projectId} onChange={(e) => set("projectId", e.target.value)} className={inputCls}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Location"><input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="Bldg / Level / Room" className={inputCls} /></Field>
            <Field label="Type / Category"><select value={f.category} onChange={(e) => set("category", e.target.value)} className={inputCls}>{CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}</select></Field>
            <Field label="Trade"><select value={f.trade} onChange={(e) => set("trade", e.target.value)} className={inputCls}>{TRADES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Priority"><select value={f.priority} onChange={(e) => set("priority", e.target.value)} className={inputCls}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></Field>
            <Field label="Due date"><input type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} className={inputCls} /></Field>
          </div>
          <MultiAssign value={f.assignees} onChange={(v) => set("assignees", v)} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Punch Item Manager"><select value={f.punchManagerId} onChange={(e) => set("punchManagerId", e.target.value)} className={inputCls}><option value="">—</option>{people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            <Field label="Final Approver"><select value={f.finalApproverId} onChange={(e) => set("finalApproverId", e.target.value)} className={inputCls}><option value="">—</option>{people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
          </div>
          <MultiAssign value={f.distribution} onChange={(v) => set("distribution", v)} label="Distribution list" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Cost impact"><select value={f.costImpact} onChange={(e) => set("costImpact", e.target.value)} className={inputCls}>{IMPACT.map((i) => <option key={i} value={i}>{IMPACT_LABEL[i]}</option>)}</select></Field>
            <Field label="Schedule impact"><select value={f.scheduleImpact} onChange={(e) => set("scheduleImpact", e.target.value)} className={inputCls}>{IMPACT.map((i) => <option key={i} value={i}>{IMPACT_LABEL[i]}</option>)}</select></Field>
            <Field label="Cost code"><input value={f.costCode} onChange={(e) => set("costCode", e.target.value)} className={inputCls} /></Field>
            <Field label="Reference"><input value={f.reference} onChange={(e) => set("reference", e.target.value)} className={inputCls} /></Field>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-[#8A95A5]"><input type="checkbox" checked={f.isPrivate} onChange={(e) => set("isPrivate", e.target.checked)} className="accent-[#FF6B1A]" /> Private (restrict visibility)</label>
        </div>
        <div className="px-5 py-4 border-t border-[#222A35] flex gap-2 sticky bottom-0 bg-[#11161D]">
          <button onClick={onClose} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Cancel</button>
          {!initial.id && <button disabled={saving} onClick={() => save(true)} className="flex-1 h-10 rounded-md border border-[#FF6B1A]/40 text-[12px] text-[#FF6B1A] disabled:opacity-50">Save & create new</button>}
          <button disabled={saving} onClick={() => save(false)} className="flex-1 h-10 rounded-md bg-[#FF6B1A] text-white text-[12px] disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Detail panel ─────────────────────────── */
export function PunchDetail({ id, role, onClose, onChange }: { id: string; role: Role; onClose: () => void; onChange: () => void }) {
  const [item, setItem] = useState<any>(null);
  const [comment, setComment] = useState("");
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pr = punchRoleFor(role);
  const load = () => api.getPunchItem(id).then(setItem).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!item) return <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center" onClick={onClose}><Loader2 className="w-5 h-5 text-white animate-spin" /></div>;
  const M = STATUS_META[item.status as PunchStatus] || STATUS_META.open; const asg = parseArr(item.assignees);
  const transitions: { s: PunchStatus; label: string }[] = [
    { s: "in_progress", label: "Start work" }, { s: "ready_for_review", label: "Ready for review" },
    { s: "resolved", label: "Mark resolved" }, { s: "closed", label: "Close" }, { s: "rejected", label: "Reject / reopen" },
  ];
  const changeStatus = async (s: PunchStatus) => {
    try { await api.setPunchStatus(id, s, pr); toast.success(`Moved to ${STATUS_META[s].label}`); load(); onChange(); }
    catch (e: any) { toast.error(e.message || "Not permitted for your role"); }
  };
  const addComment = async () => { if (!comment.trim()) return; await api.addPunchComment(id, comment.trim()); setComment(""); load(); };
  const addPhoto = async (file?: File) => { if (!file) return; toast.info("Uploading photo…"); try { const url = await api.uploadFile(file); await api.addPunchAttachment(id, url, "image"); load(); } catch { toast.error("Photo upload failed"); } };

  return (
    <>
    <div className="fixed inset-0 z-[60] bg-black/60 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-[#11161D] border-l border-[#222A35] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between sticky top-0 bg-[#11161D]">
          <div className="min-w-0">
            <div className="text-[11px] font-mono text-[#5B6675]">{item.code}</div>
            <div className="text-[14px] text-white font-display truncate">{item.title || item.desc}</div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => exportItemPDF(item, item.comments || [], item.activity || [])} title="Export PDF" className="w-8 h-8 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><Download className="w-4 h-4" /></button>
            <button onClick={onClose} className="w-8 h-8 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[11px] px-2 py-1 rounded-full border ${M.cls}`}>{M.label}</span>
            <span className={`text-[11px] capitalize ${PRIORITY_CLS[item.priority || "medium"]}`}>{item.priority} priority</span>
            {item.isPrivate && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#5B6675]/15 text-[#8A95A5]">Private</span>}
          </div>

          {/* workflow */}
          <div className="flex flex-wrap gap-1.5">
            {transitions.filter((t) => t.s !== item.status).map((t) => (
              <button key={t.s} onClick={() => changeStatus(t.s)} className="text-[11px] px-2.5 py-1.5 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white hover:border-[#FF6B1A]/40">{t.label}</button>
            ))}
          </div>

          {/* summary grid */}
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            {[["Location", item.location || item.area], ["Trade", item.trade], ["Category", item.category], ["Due", item.dueDate], ["Cost impact", IMPACT_LABEL[item.costImpact || "tbd"]], ["Schedule impact", IMPACT_LABEL[item.scheduleImpact || "tbd"]], ["Reference", item.reference], ["Cost code", item.costCode]].map(([k, v]) => (
              <div key={k as string}><div className="text-[10px] uppercase text-[#5B6675]">{k}</div><div className="text-white">{v || "—"}</div></div>
            ))}
          </div>
          <div><div className="text-[10px] uppercase text-[#5B6675] mb-1">Assignees</div><div className="flex flex-wrap gap-1">{asg.length ? asg.map((a) => <span key={a} className="text-[11px] px-1.5 py-0.5 rounded bg-[#FF6B1A]/15 text-[#FF6B1A]">{nameOf(a)}</span>) : <span className="text-[#5B6675] text-[12px]">Unassigned</span>}</div></div>
          {item.linkedDrawingId && <button onClick={() => toast("Opening drawing at pin…")} className="w-full h-9 rounded-md border border-[#3B82F6]/30 bg-[#3B82F6]/10 text-[#3B82F6] text-[12px] flex items-center justify-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Open on drawing</button>}

          {/* attachments */}
          <div>
            <div className="flex items-center justify-between mb-1.5"><div className="text-[10px] uppercase text-[#5B6675]">Attachments</div><button onClick={() => fileRef.current?.click()} className="text-[11px] text-[#FF6B1A] flex items-center gap-1"><Paperclip className="w-3 h-3" /> Add photo</button></div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addPhoto(e.target.files?.[0])} />
            <div className="grid grid-cols-3 gap-2">
              {(item.attachments || []).map((a: any, i: number) => <button key={a.id} type="button" onClick={() => setLightbox({ images: (item.attachments || []).map((x: any) => x.fileUrl), index: i })} className="block"><img src={a.fileUrl} alt="att" className="w-full h-16 object-cover rounded border border-[#222A35] cursor-pointer hover:opacity-80" /></button>)}
              {(item.attachments || []).length === 0 && <div className="col-span-3 text-[11px] text-[#5B6675] flex items-center gap-1"><ImageIcon className="w-3.5 h-3.5" /> No photos yet</div>}
            </div>
          </div>

          {/* comments */}
          <div>
            <div className="text-[10px] uppercase text-[#5B6675] mb-1.5 flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Comments</div>
            <div className="space-y-2 mb-2">
              {(item.comments || []).map((c: any) => (
                <div key={c.id} className="text-[12px]"><span className="text-white">{nameOf(c.authorId)}</span> <span className="text-[10px] text-[#5B6675]">{new Date(c.createdAt).toLocaleString()}</span><div className="text-[#C2CAD6]">{c.text}</div></div>
              ))}
              {(item.comments || []).length === 0 && <div className="text-[11px] text-[#5B6675]">No comments yet.</div>}
            </div>
            <div className="flex gap-2"><input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addComment()} placeholder="Add a comment…" className="flex-1 h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" /><button onClick={addComment} className="h-9 px-3 rounded-md bg-[#FF6B1A] text-white"><Send className="w-3.5 h-3.5" /></button></div>
          </div>

          {/* activity */}
          <div>
            <div className="text-[10px] uppercase text-[#5B6675] mb-1.5 flex items-center gap-1"><Clock className="w-3 h-3" /> Activity</div>
            <div className="space-y-1.5">
              {(item.activity || []).map((a: any) => (
                <div key={a.id} className="text-[11px] text-[#8A95A5] flex items-center gap-2"><CircleDot className="w-2.5 h-2.5 text-[#FF6B1A]" /> <span className="capitalize">{a.actionType.replace("_", " ")}</span>{a.after && a.after !== "updated" ? <span className="text-white">→ {a.after}</span> : null}<span className="ml-auto text-[#5B6675]">{new Date(a.createdAt).toLocaleDateString()}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
    {lightbox && <ImageLightbox images={lightbox.images} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </>
  );
}
