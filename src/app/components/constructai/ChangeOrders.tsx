// ============================================================================
// Change Orders — production module wired to the backend (/api/change-orders).
// Table + filters + search · create/edit form (multi-assignee) · detail panel
// with status workflow · CSV export. Original UI.
// ============================================================================

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  Plus, Search, Download, X, FileText, Clock, AlertTriangle, ChevronDown,
  CheckSquare, Square, Loader2, DollarSign, CalendarClock, MessageSquare, Send,
} from "lucide-react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import { TEAM_MEMBERS } from "./team-data";
import { useTeam, resolveName } from "./useTeam";
import api, { type ChangeOrderActivityDto } from "../../services/api";

type COStatus = "drafted" | "pm_review" | "owner_approval" | "approved" | "rejected" | "void";
interface ChangeOrder {
  id: string; number?: string; title?: string; area?: string; description?: string;
  status: COStatus; trigger?: string; rfi?: string; costUSD?: number; scheduleImpactDays?: number;
  assignees?: string; requestedBy?: string; submittedDate?: string; projectId: string;
  createdAt?: string; updatedAt?: string;
}

const STATUS_META: Record<COStatus, { label: string; cls: string }> = {
  drafted:        { label: "Drafted",        cls: "bg-[#5B6675]/15 text-[#8A95A5] border-[#5B6675]/30" },
  pm_review:      { label: "PM Review",       cls: "bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/30" },
  owner_approval: { label: "Owner Approval",  cls: "bg-[#FF6B1A]/15 text-[#FF6B1A] border-[#FF6B1A]/30" },
  approved:       { label: "Approved",        cls: "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30" },
  rejected:       { label: "Rejected",        cls: "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30" },
  void:           { label: "Void",            cls: "bg-[#5B6675]/15 text-[#5B6675] border-[#5B6675]/30" },
};
const TRIGGERS = ["Design clarification", "Owner request", "Unforeseen condition", "Code compliance", "Structural review", "Weather / delays", "Other"];
const parseArr = (s?: string): string[] => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
const nameOf = (id: string) => resolveName(id);
const fmt = (n?: number) => "$" + Math.round(n || 0).toLocaleString("en-US");

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
        {value.map((id) => <span key={id} className="text-[11px] px-1.5 py-0.5 rounded bg-[#FF6B1A]/15 text-[#FF6B1A] flex items-center gap-1">{nameOf(id)}<span onClick={(e) => { e.stopPropagation(); toggle(id); }}><X className="w-3 h-3" /></span></span>)}
        <ChevronDown className="w-3.5 h-3.5 text-[#5B6675] ml-auto" />
      </button>
      {open && (<>
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
      </>)}
    </div>
  );
}

export default function ChangeOrders({ role }: { role: Role }) {
  const perms = ROLES[role];
  const canCreate = perms.createCO || perms.approveAny;
  const canApprove = perms.approveAny;
  const [items, setItems] = useState<ChangeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [filters, setFilters] = useState({ projectId: "", status: "", q: "" });
  const [showForm, setShowForm] = useState<null | ChangeOrder>(null);
  const [detail, setDetail] = useState<ChangeOrder | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (filters.projectId) params.projectId = filters.projectId;
      if (filters.status) params.status = filters.status;
      setItems(await api.listChangeOrders(params));
    } catch { setItems([]); }
    setLoading(false);
  };
  useEffect(() => { api.getProjects().then((p) => setProjects(p.map((x) => ({ id: x.id, name: x.name })))).catch(() => {}); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.projectId, filters.status]);

  const projName = (id: string) => projects.find((p) => p.id === id)?.name || "—";
  const filtered = useMemo(() => {
    const q = filters.q.toLowerCase();
    return q ? items.filter((c) => `${c.number} ${c.title} ${c.trigger} ${c.area}`.toLowerCase().includes(q)) : items;
  }, [items, filters.q]);

  const totals = useMemo(() => {
    const cost = filtered.reduce((s, c) => s + (c.costUSD || 0), 0);
    const days = filtered.reduce((s, c) => s + (c.scheduleImpactDays || 0), 0);
    const pending = filtered.filter((c) => !["approved", "rejected", "void"].includes(c.status)).length;
    return { cost, days, pending };
  }, [filtered]);

  const exportCSV = () => {
    const cols = ["Number", "Title", "Project", "Status", "Trigger", "Cost (USD)", "Schedule (days)", "Assignees", "Submitted"];
    const rows = filtered.map((c) => [c.number, c.title, projName(c.projectId), STATUS_META[c.status]?.label, c.trigger, c.costUSD, c.scheduleImpactDays, parseArr(c.assignees).map(nameOf).join("; "), c.submittedDate].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[cols.join(","), ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `change-orders-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    toast.success("Change orders exported as CSV");
  };

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-4">
      {/* roll-up */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4"><div className="text-[11px] text-[#8A95A5]">Total change orders</div><div className="text-[22px] text-white font-display">{filtered.length}</div></div>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4"><div className="text-[11px] text-[#8A95A5] flex items-center gap-1"><DollarSign className="w-3 h-3" /> Net cost impact</div><div className="text-[22px] text-[#FF6B1A] font-display">{fmt(totals.cost)}</div></div>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4"><div className="text-[11px] text-[#8A95A5] flex items-center gap-1"><CalendarClock className="w-3 h-3" /> Net schedule</div><div className="text-[22px] text-white font-display">{totals.days >= 0 ? "+" : ""}{totals.days}d</div></div>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4"><div className="text-[11px] text-[#8A95A5]">Pending approval</div><div className="text-[22px] text-[#F5A623] font-display">{totals.pending}</div></div>
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B6675]" />
          <input value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="Search number, title, trigger…" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg pl-9 pr-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
        </div>
        <select value={filters.projectId} onChange={(e) => setFilters((f) => ({ ...f, projectId: e.target.value }))} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white"><option value="">All statuses</option>{(Object.keys(STATUS_META) as COStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select>
        <button onClick={exportCSV} className="h-9 px-2.5 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> CSV</button>
        {canCreate && <button onClick={() => setShowForm({ id: "", projectId: projects[0]?.id || "", status: "drafted" } as ChangeOrder)} className="h-9 px-4 bg-[#FF6B1A] text-white rounded-lg text-[12px] flex items-center gap-1.5 hover:bg-[#FF7E33]"><Plus className="w-3.5 h-3.5" /> Create Change Order</button>}
      </div>

      {/* table */}
      <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[12px]">
            <thead><tr className="text-[10px] text-[#5B6675] uppercase tracking-wider border-b border-[#222A35]">
              <th className="text-left px-3 py-2.5">Number</th><th className="text-left px-3 py-2.5">Title</th><th className="text-left px-3 py-2.5">Project</th>
              <th className="text-left px-3 py-2.5">Trigger</th><th className="text-right px-3 py-2.5">Cost</th><th className="text-right px-3 py-2.5">Schedule</th>
              <th className="text-left px-3 py-2.5">Assignees</th><th className="text-left px-3 py-2.5">Status</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="text-center py-10 text-[#5B6675]"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-[#5B6675]">No change orders yet.</td></tr>}
              {!loading && filtered.map((c) => {
                const asg = parseArr(c.assignees);
                return (
                  <tr key={c.id} onClick={() => setDetail(c)} className="border-b border-[#222A35] hover:bg-[#161C24] cursor-pointer">
                    <td className="px-3 py-2.5 font-mono text-[#8A95A5]">{c.number}</td>
                    <td className="px-3 py-2.5 text-white max-w-[240px] truncate">{c.title}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{projName(c.projectId)}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{c.trigger || "—"}</td>
                    <td className="px-3 py-2.5 text-right text-[#FF6B1A]">{fmt(c.costUSD)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8A95A5]">{(c.scheduleImpactDays || 0) >= 0 ? "+" : ""}{c.scheduleImpactDays || 0}d</td>
                    <td className="px-3 py-2.5 text-[#8A95A5] truncate max-w-[140px]">{asg.length ? asg.map(nameOf).join(", ") : <span className="text-[#5B6675]">—</span>}</td>
                    <td className="px-3 py-2.5"><span className={`text-[10px] px-2 py-1 rounded-full border ${STATUS_META[c.status]?.cls}`}>{STATUS_META[c.status]?.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && <COForm projects={projects} initial={showForm} canApprove={canApprove} onClose={() => setShowForm(null)} onSaved={() => { setShowForm(null); load(); }} />}
      {detail && <CODetail co={detail} projName={projName} canCreate={canCreate} canApprove={canApprove} onClose={() => setDetail(null)} onEdit={() => { setShowForm(detail); setDetail(null); }} onChanged={(updated) => { setDetail(updated); load(); }} />}
    </div>
  );
}

/* ───────── Form ───────── */
function COForm({ projects, initial, canApprove, onClose, onSaved }: { projects: { id: string; name: string }[]; initial: ChangeOrder; canApprove: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({
    projectId: initial.projectId || projects[0]?.id || "", number: initial.number || "", title: initial.title || "",
    area: initial.area || "", description: initial.description || "", status: initial.status || "drafted",
    trigger: initial.trigger || "Design clarification", rfi: initial.rfi || "", costUSD: initial.costUSD || 0,
    scheduleImpactDays: initial.scheduleImpactDays || 0, assignees: parseArr(initial.assignees),
    requestedBy: initial.requestedBy || "", submittedDate: initial.submittedDate || new Date().toISOString().slice(0, 10),
  });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);
  const cls = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]";
  const F = ({ label, children }: { label: string; children: any }) => (<div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">{label}</div>{children}</div>);

  const save = async () => {
    if (!f.title.trim()) return toast.error("Title is required");
    if (!f.projectId) return toast.error("Pick a project");
    setSaving(true);
    try {
      const payload = { ...f, costUSD: Number(f.costUSD) || 0, scheduleImpactDays: Number(f.scheduleImpactDays) || 0 };
      if (initial.id) await api.updateChangeOrder(initial.id, payload); else await api.createChangeOrder(payload);
      toast.success(initial.id ? "Change order updated" : "Change order created");
      onSaved();
    } catch (e: any) { toast.error(e.message || "Save failed"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between sticky top-0 bg-[#11161D]">
          <div className="text-[15px] text-white font-display">{initial.id ? "Edit change order" : "Create change order"}</div>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <F label="Title *"><input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="What changed and why" className={cls} /></F>
          <F label="Description"><textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-2 py-1.5 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A] resize-none" /></F>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <F label="Project"><select value={f.projectId} onChange={(e) => set("projectId", e.target.value)} className={cls}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></F>
            <F label="Number (auto if blank)"><input value={f.number} onChange={(e) => set("number", e.target.value)} placeholder="CO-####" className={cls} /></F>
            <F label="Area / Location"><input value={f.area} onChange={(e) => set("area", e.target.value)} className={cls} /></F>
            <F label="Trigger"><select value={f.trigger} onChange={(e) => set("trigger", e.target.value)} className={cls}>{TRIGGERS.map((t) => <option key={t}>{t}</option>)}</select></F>
            <F label="Linked RFI"><input value={f.rfi} onChange={(e) => set("rfi", e.target.value)} placeholder="RFI #" className={cls} /></F>
            <F label="Status"><select value={f.status} onChange={(e) => set("status", e.target.value)} className={cls}>{(Object.keys(STATUS_META) as COStatus[]).map((s) => <option key={s} value={s} disabled={(s === "approved" || s === "rejected") && !canApprove}>{STATUS_META[s].label}{(s === "approved" || s === "rejected") && !canApprove ? " (needs approver)" : ""}</option>)}</select></F>
            <F label="Cost impact (USD)"><input type="number" value={f.costUSD} onChange={(e) => set("costUSD", e.target.value)} className={cls} /></F>
            <F label="Schedule impact (days)"><input type="number" value={f.scheduleImpactDays} onChange={(e) => set("scheduleImpactDays", e.target.value)} className={cls} /></F>
            <F label="Requested by"><input value={f.requestedBy} onChange={(e) => set("requestedBy", e.target.value)} className={cls} /></F>
          </div>
          <MultiAssign value={f.assignees} onChange={(v) => set("assignees", v)} />
        </div>
        <div className="px-5 py-4 border-t border-[#222A35] flex gap-2 sticky bottom-0 bg-[#11161D]">
          <button onClick={onClose} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Cancel</button>
          <button disabled={saving} onClick={save} className="flex-1 h-10 rounded-md bg-[#FF6B1A] text-white text-[12px] disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

/* ───────── Detail ───────── */
function CODetail({ co, projName, canCreate, canApprove, onClose, onEdit, onChanged }: { co: ChangeOrder; projName: (id: string) => string; canCreate: boolean; canApprove: boolean; onClose: () => void; onEdit: () => void; onChanged: (c: ChangeOrder) => void }) {
  const asg = parseArr(co.assignees);
  const [activity, setActivity] = useState<ChangeOrderActivityDto[]>([]);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const loadActivity = () => { api.getChangeOrderActivity(co.id).then(setActivity).catch(() => {}); };
  useEffect(loadActivity, [co.id]);
  const setStatus = async (status: COStatus) => {
    try { const updated = await api.updateChangeOrder(co.id, { status }); toast.success(`Moved to ${STATUS_META[status].label}`); onChanged(updated); loadActivity(); }
    catch (e: any) { toast.error(e.message || "Update failed"); }
  };
  const postComment = async () => {
    const m = comment.trim();
    if (!m) return;
    setPosting(true);
    try { await api.addChangeOrderComment(co.id, m); setComment(""); loadActivity(); }
    catch (e: any) { toast.error(e.message || "Could not post comment"); }
    setPosting(false);
  };
  const actLabel = (a: ChangeOrderActivityDto): string => {
    if (a.type === "created") return "created this change order";
    if (a.type === "status") return `moved it to ${STATUS_META[(a.toStatus || "") as COStatus]?.label || a.toStatus}`;
    if (a.type === "edited") return "updated the details";
    return "";
  };
  const timeAgo = (iso: string) => {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return "just now";
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-[#11161D] border-l border-[#222A35] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between sticky top-0 bg-[#11161D]">
          <div className="min-w-0"><div className="text-[11px] font-mono text-[#5B6675]">{co.number}</div><div className="text-[14px] text-white font-display truncate">{co.title}</div></div>
          <div className="flex items-center gap-1">
            {canCreate && <button onClick={onEdit} className="h-8 px-3 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white">Edit</button>}
            <button onClick={onClose} className="w-8 h-8 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[11px] px-2 py-1 rounded-full border ${STATUS_META[co.status]?.cls}`}>{STATUS_META[co.status]?.label}</span>
            <span className="text-[12px] text-[#FF6B1A]">{fmt(co.costUSD)}</span>
            <span className="text-[12px] text-[#8A95A5]">{(co.scheduleImpactDays || 0) >= 0 ? "+" : ""}{co.scheduleImpactDays || 0} days</span>
          </div>
          {/* workflow */}
          <div className="flex flex-wrap gap-1.5">
            {co.status === "drafted" && canCreate && <button onClick={() => setStatus("pm_review")} className="text-[11px] px-2.5 py-1.5 rounded-md border border-[#3B82F6]/30 text-[#3B82F6]">Submit for PM review</button>}
            {co.status === "pm_review" && canCreate && <button onClick={() => setStatus("owner_approval")} className="text-[11px] px-2.5 py-1.5 rounded-md border border-[#FF6B1A]/30 text-[#FF6B1A]">Send for owner approval</button>}
            {canApprove && co.status !== "approved" && <button onClick={() => setStatus("approved")} className="text-[11px] px-2.5 py-1.5 rounded-md border border-[#22C55E]/30 text-[#22C55E]">Approve</button>}
            {canApprove && co.status !== "rejected" && <button onClick={() => setStatus("rejected")} className="text-[11px] px-2.5 py-1.5 rounded-md border border-[#EF4444]/30 text-[#EF4444]">Reject</button>}
          </div>
          {co.description && <p className="text-[13px] text-[#C2CAD6]">{co.description}</p>}
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            {[["Project", projName(co.projectId)], ["Area", co.area], ["Trigger", co.trigger], ["RFI", co.rfi], ["Requested by", co.requestedBy], ["Submitted", co.submittedDate]].map(([k, v]) => (
              <div key={k as string}><div className="text-[10px] uppercase text-[#5B6675]">{k}</div><div className="text-white">{v || "—"}</div></div>
            ))}
          </div>
          <div><div className="text-[10px] uppercase text-[#5B6675] mb-1">Assignees</div><div className="flex flex-wrap gap-1">{asg.length ? asg.map((a) => <span key={a} className="text-[11px] px-1.5 py-0.5 rounded bg-[#FF6B1A]/15 text-[#FF6B1A]">{nameOf(a)}</span>) : <span className="text-[#5B6675] text-[12px]">Unassigned</span>}</div></div>

          {/* Activity & comments — who did what, when */}
          <div className="pt-2 border-t border-[#222A35]">
            <div className="text-[10px] uppercase text-[#5B6675] mb-2 flex items-center gap-1.5"><Clock className="w-3 h-3" /> Activity</div>
            <div className="flex items-center gap-2 mb-3">
              <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); postComment(); } }} placeholder="Add a comment…" className="flex-1 h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2.5 text-[12px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]" />
              <button onClick={postComment} disabled={posting || !comment.trim()} className="h-9 w-9 shrink-0 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white flex items-center justify-center disabled:opacity-40">{posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}</button>
            </div>
            <div className="space-y-2.5">
              {activity.length === 0 && <div className="text-[12px] text-[#5B6675]">No activity yet.</div>}
              {activity.map((a) => (
                <div key={a.id} className="flex gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-[#222A35] flex items-center justify-center shrink-0 mt-0.5">
                    {a.type === "comment" ? <MessageSquare className="w-3 h-3 text-[#8A95A5]" /> : <Clock className="w-3 h-3 text-[#8A95A5]" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-[#C2CAD6]">
                      <span className="text-white font-medium">{a.userName || "Someone"}</span>
                      {a.userRole ? <span className="text-[#5B6675]"> · {a.userRole}</span> : null}
                      {a.type === "comment" ? <span className="text-[#5B6675]"> commented</span> : <> {actLabel(a)}</>}
                    </div>
                    {a.type === "comment" && a.message && <div className="text-[12px] text-[#C2CAD6] mt-0.5 bg-[#0A0E14] border border-[#222A35] rounded-md px-2.5 py-1.5">{a.message}</div>}
                    <div className="text-[10px] text-[#5B6675] mt-0.5">{timeAgo(a.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
