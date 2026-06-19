// ============================================================================
// Tasks & Trades — Assignments & Progress. A trade-centric view over the
// Checklists data: assign forms/checklists to people, then track status and
// completion by trade. (Form authoring lives in the Checklists Form Builder;
// this page is about assigning and watching progress — not creating tasks.)
// ============================================================================

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Search, Filter, Users, Clock, Loader2, ClipboardList, UserCheck, PenTool, CheckCircle2, AlertTriangle, Eye, Plus, X, FileText, ArrowRight, TrendingUp, Check } from "lucide-react";
import type { Role } from "./roles";
import { ROLES, TRADE_COLOR } from "./roles";
import { useTeam, resolveName } from "./useTeam";
import api, { type ChecklistDto, type ChecklistTemplateDto, type ChecklistQuestionDto, type ProjectDto } from "../../services/api";
import { STATUS_META, AssignModal, FillModal, DetailModal } from "./Checklists";

// Sort within a trade so the things needing attention float up.
const STATUS_RANK: Record<string, number> = { submitted: 0, in_progress: 1, assigned: 2, draft: 3, rejected: 4, approved: 5 };

export function Tasks({ role = "Contractor" }: { role?: Role }) {
  const perms = ROLES[role];
  const canManage = perms.canCreateInspection || perms.isWorkspaceOwner;
  const canAssign = perms.canCreateInspection || role === "Project Manager" || role === "Superintendent" || (perms as any).assignTasks || perms.isWorkspaceOwner;
  const canFill = perms.canFillInspection || role === "Worker" || role === "Trade Lead";

  useTeam(); // load real users so assignee names resolve + re-render when ready
  const [checklists, setChecklists] = useState<ChecklistDto[]>([]);
  const [templates, setTemplates] = useState<ChecklistTemplateDto[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tradeFilter, setTradeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [assign, setAssign] = useState<ChecklistDto | null>(null);
  const [fill, setFill] = useState<ChecklistDto | null>(null);
  const [detail, setDetail] = useState<ChecklistDto | null>(null);
  const [pickOpen, setPickOpen] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [c, t, p] = await Promise.all([api.getChecklists(), api.getChecklistTemplates(), api.getProjects().catch(() => [])]);
      setChecklists(Array.isArray(c) ? c : []);
      setTemplates(Array.isArray(t) ? t : []);
      setProjects(Array.isArray(p) ? p : []);
    } catch { /* leave as-is */ }
    setLoading(false);
  }
  useEffect(() => { loadData(); }, []);

  // Trade comes from the checklist's own field (set on create); fall back to the
  // source template for older checklists created before the field existed.
  const tradeOf = (c: ChecklistDto) => c.trade || templates.find((t) => t.id === c.templateId)?.trade || "Unassigned";
  const pct = (c: ChecklistDto) => (c.questions.length ? Math.round(((c.responses?.length || 0) / c.questions.length) * 100) : 0);
  const names = (assignedTo?: string | null) => {
    if (!assignedTo) return "";
    try { const ids: string[] = JSON.parse(assignedTo); return ids.map((id) => resolveName(id)).join(", "); } catch { return assignedTo; }
  };

  const filtered = useMemo(() => checklists.filter((c) => {
    if (q && !c.title.toLowerCase().includes(q.toLowerCase())) return false;
    if (tradeFilter && tradeOf(c) !== tradeFilter) return false;
    if (statusFilter && c.status !== statusFilter) return false;
    return true;
  }), [checklists, templates, q, tradeFilter, statusFilter]);

  // Group filtered checklists by trade, sorted with attention-needed first.
  const groups = useMemo(() => {
    const map = new Map<string, ChecklistDto[]>();
    for (const c of filtered) { const tr = tradeOf(c); if (!map.has(tr)) map.set(tr, []); map.get(tr)!.push(c); }
    for (const arr of map.values()) arr.sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, templates]);

  // Top-line summary across everything currently in view.
  const stats = useMemo(() => {
    const awaiting = filtered.filter((c) => c.status === "assigned" || c.status === "in_progress").length;
    const review = filtered.filter((c) => c.status === "submitted").length;
    const done = filtered.filter((c) => c.status === "approved").length;
    const active = filtered.filter((c) => c.status !== "draft");
    const avg = active.length ? Math.round(active.reduce((s, c) => s + pct(c), 0) / active.length) : 0;
    return { total: filtered.length, awaiting, review, done, avg };
  }, [filtered]);

  const tradeOptions = useMemo(() => Array.from(new Set([...templates.map((t) => t.trade), ...checklists.map(tradeOf)])).filter(Boolean).sort(), [templates, checklists]);

  // PM roll-up: average the contractors' reported field % per project (only over
  // assignments that have a reported value). This is a *suggestion* a manager
  // confirms — it does not auto-write to the project.
  const projectRollup = useMemo(() => {
    const byProject = new Map<string, number[]>();
    for (const c of checklists) {
      if (!c.projectId || c.reportedProgress == null) continue;
      if (!byProject.has(c.projectId)) byProject.set(c.projectId, []);
      byProject.get(c.projectId)!.push(c.reportedProgress);
    }
    return projects
      .map((p) => {
        const vals = byProject.get(p.id) || [];
        if (!vals.length) return null;
        const suggested = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
        return { id: p.id, name: p.name, current: p.progress ?? 0, suggested, count: vals.length };
      })
      .filter(Boolean) as { id: string; name: string; current: number; suggested: number; count: number }[];
  }, [checklists, projects]);

  // Actions (same lifecycle as the Checklists module).
  async function onAssign(id: string, userIds: string[]) {
    if (!userIds.length) return;
    try { await api.assignChecklist(id, userIds); toast.success("Assigned"); loadData(); } catch { toast.error("Assignment failed"); }
  }
  async function onSubmit(id: string, questions: ChecklistQuestionDto[], answers: Record<string, string>) {
    const responses = questions.map((qq) => ({ questionId: qq.id, value: answers[qq.id] || "" }));
    try { await api.submitChecklist(id, responses); toast.success("Submitted"); loadData(); } catch { toast.error("Submit failed"); }
  }
  async function setStatus(id: string, status: string) {
    try { await api.updateChecklist(id, { status }); toast.success("Status updated"); loadData(); } catch { toast.error("Update failed"); }
  }
  async function assignFromTemplate(t: ChecklistTemplateDto, projectId?: string) {
    try {
      const c = await api.createChecklistFromTemplate(t.id, projectId ? { projectId } : {});
      setPickOpen(false);
      await loadData();
      setAssign(c); // jump straight to picking who it goes to
    } catch { toast.error("Could not start that form"); }
  }
  // Contractor reports how far the actual work is (0-100), separate from QA %.
  async function reportProgress(id: string, pctValue: number) {
    try { await api.setChecklistProgress(id, pctValue); loadData(); } catch { toast.error("Could not update progress"); }
  }
  // PM confirms the rolled-up field % onto the project's headline progress bar.
  async function applyProjectProgress(projectId: string, pctValue: number) {
    try { await api.updateProject(projectId, { progress: pctValue }); toast.success("Project progress updated"); loadData(); }
    catch { toast.error("Could not update project"); }
  }

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="In view" value={stats.total} icon={<ClipboardList className="w-4 h-4" />} tint="#8A95A5" />
        <StatCard label="Awaiting completion" value={stats.awaiting} icon={<Clock className="w-4 h-4" />} tint="#3B82F6" />
        <StatCard label="Needs review" value={stats.review} icon={<AlertTriangle className="w-4 h-4" />} tint="#8B5CF6" />
        <StatCard label="Avg completion" value={`${stats.avg}%`} icon={<CheckCircle2 className="w-4 h-4" />} tint="#22C55E" />
      </div>

      {/* PM-confirmed project progress roll-up (field progress reported by crews) */}
      {canManage && projectRollup.length > 0 && (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
          <div className="flex items-center gap-2 px-4 h-11 border-b border-[#222A35]">
            <TrendingUp className="w-4 h-4 text-[#FF6B1A]" />
            <span className="text-[13px] text-white font-medium">Project progress — reported by crews</span>
            <span className="text-[10px] text-[#5B6675] ml-1">average of field % reported on assignments · confirm to update the project</span>
          </div>
          <div className="divide-y divide-[#222A35]">
            {projectRollup.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-white truncate">{r.name}</div>
                  <div className="text-[11px] text-[#8A95A5] mt-0.5">Reported {r.suggested}% from {r.count} assignment{r.count > 1 ? "s" : ""} · project bar at {r.current}%</div>
                </div>
                <div className="flex items-center gap-2 w-40">
                  <div className="flex-1 h-1.5 rounded-full bg-[#222A35] overflow-hidden"><div className="h-full rounded-full bg-[#FF6B1A]" style={{ width: `${r.suggested}%` }} /></div>
                  <span className="text-[11px] tabular-nums text-white w-9 text-right">{r.suggested}%</span>
                </div>
                <button
                  onClick={() => applyProjectProgress(r.id, r.suggested)}
                  disabled={r.suggested === r.current}
                  title={r.suggested === r.current ? "Project already at this value" : "Set the project progress to the reported figure"}
                  className="h-8 px-2.5 rounded-lg text-[11px] flex items-center gap-1 bg-[#22C55E]/10 border border-[#22C55E]/30 text-[#22C55E] hover:bg-[#22C55E]/20 disabled:opacity-40 disabled:hover:bg-[#22C55E]/10"
                ><Check className="w-3.5 h-3.5" /> Confirm</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B6675]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search forms & checklists…" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg pl-9 pr-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
        </div>
        <select value={tradeFilter} onChange={(e) => setTradeFilter(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white"><option value="">All trades</option>{tradeOptions.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <div className="flex items-center gap-1.5"><Filter className="w-4 h-4 text-[#5B6675]" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white">
            <option value="">All statuses</option><option value="draft">Draft</option><option value="assigned">Assigned</option><option value="in_progress">In Progress</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
          </select>
        </div>
        {canAssign && <button onClick={() => setPickOpen(true)} className="h-9 px-4 bg-[#FF6B1A] text-white rounded-lg text-[12px] flex items-center gap-1.5 hover:bg-[#FF7E33]"><Plus className="w-3.5 h-3.5" /> Assign a form</button>}
      </div>

      {/* Trade groups */}
      {loading ? (
        <div className="text-center py-16 text-[#5B6675] text-[13px]"><Loader2 className="w-4 h-4 animate-spin inline mr-1.5" /> Loading assignments…</div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#222A35] p-8 text-center">
          <ClipboardList className="w-7 h-7 text-[#5B6675] mx-auto mb-2" />
          <div className="text-[13px] text-white">Nothing assigned yet</div>
          <div className="text-[12px] text-[#8A95A5] mt-1">{canAssign ? "Click “Assign a form” to send a checklist to a trade or teammate." : "Forms assigned to you will show up here."}</div>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([trade, list]) => {
            const color = TRADE_COLOR(trade as any);
            const active = list.filter((c) => c.status !== "draft");
            const avg = active.length ? Math.round(active.reduce((s, c) => s + pct(c), 0) / active.length) : 0;
            return (
              <div key={trade} className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
                <div className="flex items-center gap-2.5 px-4 h-11 border-b border-[#222A35]">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                  <span className="text-[13px] text-white font-medium">{trade}</span>
                  <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full bg-[#222A35] text-[#8A95A5]">{list.length}</span>
                  <div className="ml-auto flex items-center gap-2 w-32">
                    <div className="flex-1 h-1.5 rounded-full bg-[#222A35] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${avg}%`, background: color }} /></div>
                    <span className="text-[10px] tabular-nums text-[#8A95A5] w-8 text-right">{avg}%</span>
                  </div>
                </div>
                <div className="divide-y divide-[#222A35]">
                  {list.map((c) => {
                    const st = STATUS_META[c.status] || STATUS_META.draft;
                    const p = pct(c);
                    return (
                      <div key={c.id} className="p-4 hover:bg-[#161D27] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1"><span className={`text-[10px] px-1.5 py-0.5 rounded border ${st.bg} ${st.text} ${st.border}`}>{st.label}</span>{c.category && <span className="text-[10px] text-[#5B6675]">{c.category}</span>}</div>
                          <div className="text-[13px] font-medium text-white truncate">{c.title}</div>
                          <div className="text-[11px] text-[#8A95A5] flex flex-wrap items-center gap-2 mt-0.5">
                            <span>{c.questions.length} questions</span>
                            <span className="w-1 h-1 rounded-full bg-[#222A35]" /><span>{p}% answered</span>
                            {c.reportedProgress != null && <><span className="w-1 h-1 rounded-full bg-[#222A35]" /><span className="text-[#FF6B1A]">{c.reportedProgress}% field</span></>}
                            {c.assignedTo && <><span className="w-1 h-1 rounded-full bg-[#222A35]" /><Users className="w-3 h-3" /><span className="truncate">{names(c.assignedTo)}</span></>}
                            {c.dueDate && <><span className="w-1 h-1 rounded-full bg-[#222A35]" /><Clock className="w-3 h-3" /><span>{new Date(c.dueDate).toLocaleDateString()}</span></>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {c.status === "draft" && canAssign && <button onClick={() => setAssign(c)} className="h-8 px-2.5 bg-[#222A35] rounded-lg text-[11px] text-white hover:bg-[#3B82F6]/20 flex items-center gap-1"><UserCheck className="w-3.5 h-3.5" /> Assign</button>}
                          {(c.status === "assigned" || c.status === "in_progress") && canFill && (
                            <select value={c.reportedProgress ?? ""} onChange={(e) => reportProgress(c.id, Number(e.target.value))} title="Report how far the actual work is" className="h-8 bg-[#0A0E14] border border-[#222A35] rounded-lg px-1.5 text-[11px] text-[#C2CAD6] focus:outline-none focus:border-[#FF6B1A]">
                              <option value="" disabled>Field %…</option>
                              {[0, 10, 25, 50, 75, 90, 100].map((v) => <option key={v} value={v}>{v}%</option>)}
                            </select>
                          )}
                          {(c.status === "assigned" || c.status === "in_progress") && canFill && <button onClick={() => setFill(c)} className="h-8 px-2.5 bg-[#FF6B1A]/10 border border-[#FF6B1A]/30 rounded-lg text-[11px] text-[#FF6B1A] hover:bg-[#FF6B1A]/20 flex items-center gap-1"><PenTool className="w-3.5 h-3.5" /> Fill</button>}
                          {c.status === "submitted" && canAssign && <><button onClick={() => setStatus(c.id, "approved")} className="h-8 px-2.5 bg-[#22C55E]/10 border border-[#22C55E]/30 rounded-lg text-[11px] text-[#22C55E] hover:bg-[#22C55E]/20 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Approve</button><button onClick={() => setStatus(c.id, "rejected")} className="h-8 px-2.5 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg text-[11px] text-[#EF4444] hover:bg-[#EF4444]/20 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Reject</button></>}
                          <button onClick={() => setDetail(c)} title="View" className="h-8 w-8 flex items-center justify-center bg-[#222A35] rounded-lg text-[#8A95A5] hover:text-white"><Eye className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pickOpen && <TemplatePickModal templates={templates} projects={projects} onClose={() => setPickOpen(false)} onPick={assignFromTemplate} />}
      {assign && <AssignModal checklist={assign} onClose={() => setAssign(null)} onAssign={onAssign} />}
      {fill && <FillModal checklist={fill} onClose={() => setFill(null)} onSubmit={onSubmit} />}
      {detail && <DetailModal checklist={detail} onClose={() => setDetail(null)} onAddQ={() => {}} onUpdQ={() => {}} onDelQ={() => {}} canEdit={false} />}
    </div>
  );
}

function StatCard({ label, value, icon, tint }: { label: string; value: number | string; icon: ReactNode; tint: string }) {
  return (
    <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] text-[#8A95A5]"><span style={{ color: tint }}>{icon}</span> {label}</div>
      <div className="text-[20px] text-white font-display mt-1 tabular-nums">{value}</div>
    </div>
  );
}

function TemplatePickModal({ templates, projects, onClose, onPick }: { templates: ChecklistTemplateDto[]; projects: ProjectDto[]; onClose: () => void; onPick: (t: ChecklistTemplateDto, projectId?: string) => void }) {
  const [s, setS] = useState("");
  const [projectId, setProjectId] = useState("");
  const list = templates.filter((t) => !s || `${t.title} ${t.trade}`.toLowerCase().includes(s.toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h3 className="text-[15px] font-semibold text-white flex items-center gap-2"><FileText className="w-4 h-4 text-[#FF6B1A]" /> Assign a form</h3><button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
        {projects.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Project (so progress rolls up)</div>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[12.5px] text-white focus:outline-none focus:border-[#FF6B1A]">
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        <div className="relative mb-3"><Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5B6675]" /><input value={s} onChange={(e) => setS(e.target.value)} placeholder="Search templates…" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg pl-9 pr-3 text-[12.5px] text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {list.length === 0 && <div className="text-[12px] text-[#5B6675] text-center py-6">No templates. Build one in the Checklists Form Builder first.</div>}
          {list.map((t) => {
            const items = (() => { try { return JSON.parse(t.items || "[]"); } catch { return []; } })();
            return (
              <button key={t.id} onClick={() => onPick(t, projectId || undefined)} className="w-full text-left p-3 rounded-lg border border-[#222A35] bg-[#0A0E14] hover:border-[#FF6B1A]/40 hover:bg-[#161C24] transition-colors flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-white truncate">{t.title}</div>
                  <div className="flex items-center gap-2 mt-1"><span className="text-[10px] bg-[#222A35] text-[#8A95A5] px-1.5 py-0.5 rounded">{t.trade}</span>{t.category && <span className="text-[10px] text-[#5B6675]">{t.category}</span>}<span className="text-[10px] text-[#5B6675]">{items.length} items</span></div>
                </div>
                <ArrowRight className="w-4 h-4 text-[#5B6675] shrink-0" />
              </button>
            );
          })}
        </div>
        <div className="text-[10.5px] text-[#5B6675] mt-3">Picking a form creates an assignment and lets you choose who it goes to.</div>
      </div>
    </div>
  );
}

export default Tasks;
