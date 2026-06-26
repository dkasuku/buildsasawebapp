// ============================================================================
// Schedule — a Procore-style Gantt timeline per project. Activities & milestones
// have start/end dates, a % complete bar, status, trade and assignees. Assigned
// checklists/forms (with due dates) are overlaid read-only so the field work
// shows up on the same timeline. Dates + milestones + progress (no dependencies yet).
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, X, Loader2, Trash2, Flag, CalendarDays, Pencil, ClipboardList, Sparkles } from "lucide-react";
import type { Role } from "./roles";
import { ROLES, TRADES } from "./roles";
import { useTeam, resolveName } from "./useTeam";
import api, { type ScheduleItemDto, type ProjectDto, type ChecklistDto } from "../../services/api";

const DAY = 86400000;
const STATUS: Record<string, { label: string; bar: string }> = {
  not_started: { label: "Not started", bar: "#5B6675" },
  in_progress: { label: "In progress", bar: "#FF6B1A" },
  done: { label: "Done", bar: "#22C55E" },
  blocked: { label: "Blocked", bar: "#EF4444" },
};
const d = (s: string | number | Date) => new Date(s);
const isoDay = (s: string | number | Date) => { const x = new Date(s); return isNaN(+x) ? "" : x.toISOString().slice(0, 10); };
const fmt = (s: string | number | Date) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function Schedule({ role = "Contractor" }: { role?: Role }) {
  const perms = ROLES[role];
  const canManage = perms.canCreateInspection || role === "Project Manager" || role === "Superintendent" || (perms as any).assignTasks || perms.isWorkspaceOwner || (perms as any).createCO;
  useTeam();

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [items, setItems] = useState<ScheduleItemDto[]>([]);
  const [checklists, setChecklists] = useState<ChecklistDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ScheduleItemDto | "new" | null>(null);
  const [genOpen, setGenOpen] = useState(false);

  useEffect(() => {
    api.getProjects().then((p) => {
      const list = Array.isArray(p) ? p : [];
      setProjects(list);
      setProjectId((cur) => cur || list[0]?.id || "");
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const load = () => {
    if (!projectId) { setItems([]); setChecklists([]); return; }
    Promise.all([
      api.getSchedule(projectId).catch(() => []),
      api.getChecklists({ projectId } as any).catch(() => []),
    ]).then(([s, c]) => {
      setItems(Array.isArray(s) ? s : []);
      setChecklists(Array.isArray(c) ? c : []);
    });
  };
  useEffect(load, [projectId]);

  // Field work overlaid on the timeline: assigned checklists that carry a due date.
  const overlay = useMemo(() => checklists.filter((c) => c.dueDate).map((c) => ({
    id: c.id,
    name: c.title,
    start: c.createdAt,
    end: c.dueDate as string,
    percent: c.reportedProgress != null ? c.reportedProgress : (c.questions?.length ? Math.round(((c.responses?.length || 0) / c.questions.length) * 100) : 0),
  })), [checklists]);

  // Timeline scale across every dated thing in view.
  const range = useMemo(() => {
    const ds: number[] = [];
    items.forEach((i) => { ds.push(+d(i.startDate), +d(i.endDate)); });
    overlay.forEach((o) => { ds.push(+d(o.start), +d(o.end)); });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let min = ds.length ? Math.min(...ds) : +today;
    let max = ds.length ? Math.max(...ds) : +today + 30 * DAY;
    min -= 3 * DAY; max += 3 * DAY;
    if (max - min < 14 * DAY) max = min + 14 * DAY;
    return { min, max, span: max - min, days: Math.round((max - min) / DAY) };
  }, [items, overlay]);

  const leftPct = (t: number) => ((t - range.min) / range.span) * 100;
  const widthPct = (a: number, b: number) => Math.max(0.4, ((b - a) / range.span) * 100);
  const timelineWidth = Math.max(680, range.days * 13);
  const todayLeft = leftPct(Date.now());

  const months = useMemo(() => {
    const out: { label: string; left: number; width: number }[] = [];
    const cur = new Date(range.min); cur.setDate(1); cur.setHours(0, 0, 0, 0);
    while (+cur <= range.max) {
      const mStart = Math.max(+cur, range.min);
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const mEnd = Math.min(+next, range.max);
      out.push({ label: cur.toLocaleDateString(undefined, { month: "short", year: "2-digit" }), left: leftPct(mStart), width: widthPct(mStart, mEnd) });
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }, [range]);

  const names = (a?: string | null) => { if (!a) return ""; try { return (JSON.parse(a) as string[]).map(resolveName).join(", "); } catch { return ""; } };

  async function remove(id: string) {
    if (!confirm("Delete this schedule item?")) return;
    try { await api.deleteScheduleItem(id); toast.success("Deleted"); load(); } catch { toast.error("Could not delete"); }
  }

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-4 max-w-[1500px] mx-auto">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="w-4 h-4 text-[#FF6B1A]" />
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12.5px] text-white min-w-[180px]">
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-[10.5px] text-[#8A95A5]">
          {Object.entries(STATUS).map(([k, v]) => <span key={k} className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: v.bar }} /> {v.label}</span>)}
        </div>
        {canManage && projectId && <button onClick={() => setGenOpen(true)} className="h-9 px-3 bg-[#11161D] border border-[#222A35] rounded-lg text-[12px] text-white flex items-center gap-1.5 hover:border-[#FF6B1A]"><Sparkles className="w-3.5 h-3.5 text-[#FF6B1A]" /> AI schedule</button>}
        {canManage && projectId && <button onClick={() => setEditing("new")} className="h-9 px-4 bg-[#FF6B1A] text-white rounded-lg text-[12px] flex items-center gap-1.5 hover:bg-[#FF7E33]"><Plus className="w-3.5 h-3.5" /> Add item</button>}
      </div>

      {loading ? (
        <div className="text-center py-16 text-[#5B6675] text-[13px]"><Loader2 className="w-4 h-4 animate-spin inline mr-1.5" /> Loading schedule…</div>
      ) : !projectId ? (
        <div className="rounded-xl border border-dashed border-[#222A35] p-8 text-center text-[13px] text-[#8A95A5]">Create a project first, then build its schedule here.</div>
      ) : (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
          <div className="flex">
            {/* left: names */}
            <div className="w-52 shrink-0 border-r border-[#222A35]">
              <div className="h-9 border-b border-[#222A35] px-3 flex items-center text-[10px] uppercase tracking-wider text-[#5B6675]">Activity</div>
              {items.length === 0 && overlay.length === 0 && (
                <div className="px-3 py-6 text-[12px] text-[#5B6675]">No items yet.</div>
              )}
              {items.map((i) => (
                <div key={i.id} className="group h-10 border-b border-[#222A35] px-3 flex items-center gap-1.5">
                  {i.type === "milestone" ? <Flag className="w-3 h-3 text-[#F5A623] shrink-0" /> : null}
                  <span className="text-[12px] text-white truncate flex-1" title={i.name}>{i.name}</span>
                  {canManage && (
                    <span className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                      <button onClick={() => setEditing(i)} title="Edit" className="h-6 w-6 rounded text-[#8A95A5] hover:text-white flex items-center justify-center"><Pencil className="w-3 h-3" /></button>
                      <button onClick={() => remove(i.id)} title="Delete" className="h-6 w-6 rounded text-[#5B6675] hover:text-[#EF4444] flex items-center justify-center"><Trash2 className="w-3 h-3" /></button>
                    </span>
                  )}
                </div>
              ))}
              {overlay.length > 0 && <div className="h-7 border-b border-[#222A35] px-3 flex items-center text-[10px] uppercase tracking-wider text-[#5B6675] bg-[#0A0E14]"><ClipboardList className="w-3 h-3 mr-1" /> Assigned forms</div>}
              {overlay.map((o) => (
                <div key={o.id} className="h-10 border-b border-[#222A35] px-3 flex items-center">
                  <span className="text-[12px] text-[#8A95A5] truncate" title={o.name}>{o.name}</span>
                </div>
              ))}
            </div>

            {/* right: timeline */}
            <div className="flex-1 overflow-x-auto">
              <div className="relative" style={{ minWidth: timelineWidth }}>
                {/* month header */}
                <div className="h-9 border-b border-[#222A35] relative">
                  {months.map((m, idx) => (
                    <div key={idx} className="absolute top-0 h-9 border-l border-[#222A35] flex items-center px-2 text-[10px] text-[#8A95A5]" style={{ left: `${m.left}%`, width: `${m.width}%` }}>{m.label}</div>
                  ))}
                </div>
                {/* today line */}
                {todayLeft >= 0 && todayLeft <= 100 && <div className="absolute top-9 bottom-0 w-px bg-[#FF6B1A]/50 z-10" style={{ left: `${todayLeft}%` }} />}

                {/* schedule rows */}
                {items.map((i) => {
                  const st = STATUS[i.status] || STATUS.not_started;
                  const left = leftPct(+d(i.startDate));
                  if (i.type === "milestone") {
                    return (
                      <div key={i.id} className="h-10 border-b border-[#222A35] relative">
                        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2" style={{ left: `${left}%` }} title={`${i.name} · ${fmt(i.startDate)}`}>
                          <div className="w-3.5 h-3.5 rotate-45 bg-[#F5A623] border border-[#0A0E14]" />
                        </div>
                      </div>
                    );
                  }
                  const w = widthPct(+d(i.startDate), +d(i.endDate));
                  return (
                    <div key={i.id} className="h-10 border-b border-[#222A35] relative">
                      <button onClick={() => canManage && setEditing(i)} className="absolute top-1/2 -translate-y-1/2 h-5 rounded-md overflow-hidden text-left" style={{ left: `${left}%`, width: `${w}%`, background: `${st.bar}40`, border: `1px solid ${st.bar}` }} title={`${i.name} · ${fmt(i.startDate)}–${fmt(i.endDate)} · ${i.percent}%`}>
                        <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, i.percent))}%`, background: st.bar }} />
                      </button>
                    </div>
                  );
                })}

                {/* overlay header spacer */}
                {overlay.length > 0 && <div className="h-7 border-b border-[#222A35] bg-[#0A0E14]" />}
                {/* overlay rows (read-only) */}
                {overlay.map((o) => {
                  const left = leftPct(+d(o.start));
                  const w = widthPct(+d(o.start), +d(o.end));
                  return (
                    <div key={o.id} className="h-10 border-b border-[#222A35] relative">
                      <div className="absolute top-1/2 -translate-y-1/2 h-4 rounded overflow-hidden border border-dashed border-[#3B82F6]/60 bg-[#3B82F6]/15" style={{ left: `${left}%`, width: `${w}%` }} title={`${o.name} · due ${fmt(o.end)} · ${o.percent}%`}>
                        <div className="h-full bg-[#3B82F6]/60" style={{ width: `${Math.max(0, Math.min(100, o.percent))}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {editing && projectId && (
        <ItemModal
          projectId={projectId}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {genOpen && projectId && (
        <GenerateModal projectId={projectId} onClose={() => setGenOpen(false)} onDone={() => { setGenOpen(false); load(); }} />
      )}
    </div>
  );
}

function GenerateModal({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [startDate, setStartDate] = useState(isoDay(Date.now()));
  const [weeks, setWeeks] = useState(16);
  const [busy, setBusy] = useState(false);
  const cls = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2.5 text-[12.5px] text-white focus:outline-none focus:border-[#FF6B1A]";
  const lbl = "text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1 block";
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.generateSchedule(projectId, { prompt: prompt.trim(), startDate, durationWeeks: Number(weeks) || 16 });
      toast.success(`Drafted ${r.count} item${r.count > 1 ? "s" : ""}`);
      onDone();
    } catch (e: any) { toast.error(e?.message || "Could not generate schedule"); }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between">
          <div className="text-[15px] text-white font-display flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#FF6B1A]" /> Generate schedule with AI</div>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><span className={lbl}>Describe the project</span><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="e.g. 8-storey reinforced-concrete residential tower with basement parking" className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-2.5 py-2 text-[12.5px] text-white focus:outline-none focus:border-[#FF6B1A] resize-none" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><span className={lbl}>Start date</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={cls} /></div>
            <div><span className={lbl}>Duration (weeks)</span><input type="number" min={1} max={260} value={weeks} onChange={(e) => setWeeks(Number(e.target.value) || 16)} className={cls} /></div>
          </div>
          <div className="text-[10.5px] text-[#5B6675]">Drafts phases, tasks and milestones onto the timeline (added to the current schedule). You can edit or delete anything afterward.</div>
        </div>
        <div className="px-5 py-4 border-t border-[#222A35] flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Cancel</button>
          <button disabled={busy} onClick={run} className="flex-1 h-10 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] disabled:opacity-50 flex items-center justify-center gap-1.5">{busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</> : <><Sparkles className="w-3.5 h-3.5" /> Generate</>}</button>
        </div>
      </div>
    </div>
  );
}

function ItemModal({ projectId, initial, onClose, onSaved }: { projectId: string; initial: ScheduleItemDto | null; onClose: () => void; onSaved: () => void }) {
  const team = useTeam();
  const today = isoDay(Date.now());
  const [f, setF] = useState({
    name: initial?.name || "",
    type: initial?.type || "task",
    startDate: initial ? isoDay(initial.startDate) : today,
    endDate: initial ? isoDay(initial.endDate) : today,
    percent: initial?.percent ?? 0,
    status: initial?.status || "not_started",
    trade: initial?.trade || "",
    notes: initial?.notes || "",
    assignees: (() => { try { return initial?.assignees ? (JSON.parse(initial.assignees) as string[]) : []; } catch { return []; } })(),
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  const cls = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2.5 text-[12.5px] text-white focus:outline-none focus:border-[#FF6B1A]";
  const lbl = "text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1 block";

  const save = async () => {
    if (!f.name.trim()) return toast.error("Name is required");
    if (new Date(f.endDate) < new Date(f.startDate)) return toast.error("End date can't be before the start date");
    setBusy(true);
    const payload = { ...f, name: f.name.trim(), percent: Number(f.percent) || 0, trade: f.trade || null, assignees: f.assignees };
    try {
      if (initial) await api.updateScheduleItem(initial.id, payload as any);
      else await api.createScheduleItem(projectId, payload as any);
      toast.success(initial ? "Updated" : "Added to schedule");
      onSaved();
    } catch (e: any) { toast.error(e?.message || "Could not save"); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between sticky top-0 bg-[#11161D]">
          <div className="text-[15px] text-white font-display">{initial ? "Edit item" : "New schedule item"}</div>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><span className={lbl}>Name *</span><input value={f.name} onChange={(e) => set("name", e.target.value)} className={cls} placeholder="e.g. Foundation pour — Block A" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><span className={lbl}>Type</span><select value={f.type} onChange={(e) => set("type", e.target.value)} className={cls}><option value="task">Task</option><option value="phase">Phase</option><option value="milestone">Milestone</option></select></div>
            <div><span className={lbl}>Status</span><select value={f.status} onChange={(e) => set("status", e.target.value)} className={cls}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
            <div><span className={lbl}>Start date *</span><input type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} className={cls} /></div>
            <div><span className={lbl}>{f.type === "milestone" ? "Date *" : "End date *"}</span><input type="date" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} className={cls} /></div>
            <div><span className={lbl}>% complete</span><input type="number" min={0} max={100} value={f.percent} onChange={(e) => set("percent", e.target.value)} className={cls} /></div>
            <div><span className={lbl}>Trade</span><select value={f.trade} onChange={(e) => set("trade", e.target.value)} className={cls}><option value="">—</option>{TRADES.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}</select></div>
          </div>
          <div>
            <span className={lbl}>Assignees</span>
            <div className="flex flex-wrap gap-1.5">
              {team.length === 0 && <span className="text-[11px] text-[#5B6675]">Invite teammates on the Team page first.</span>}
              {team.map((m) => {
                const on = f.assignees.includes(m.id);
                return <button key={m.id} type="button" onClick={() => set("assignees", on ? f.assignees.filter((x) => x !== m.id) : [...f.assignees, m.id])} className={`text-[11px] px-2 py-1 rounded-full border ${on ? "bg-[#FF6B1A]/15 border-[#FF6B1A]/40 text-[#FF6B1A]" : "border-[#222A35] text-[#8A95A5] hover:text-white"}`}>{m.name}</button>;
              })}
            </div>
          </div>
          <div><span className={lbl}>Notes</span><textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-2.5 py-2 text-[12.5px] text-white focus:outline-none focus:border-[#FF6B1A] resize-none" /></div>
        </div>
        <div className="px-5 py-4 border-t border-[#222A35] flex gap-2 sticky bottom-0 bg-[#11161D]">
          <button onClick={onClose} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Cancel</button>
          <button disabled={busy} onClick={save} className="flex-1 h-10 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] disabled:opacity-50 flex items-center justify-center gap-1.5">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{initial ? "Save changes" : "Add item"}</button>
        </div>
      </div>
    </div>
  );
}

export default Schedule;
