// ============================================================================
// Schedule — a Procore-style Gantt timeline per project. Activities & milestones
// have start/end dates, a % complete bar, status, trade and assignees. Assigned
// checklists/forms (with due dates) are overlaid read-only so the field work
// shows up on the same timeline. Dates + milestones + progress (no dependencies yet).
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, X, Loader2, Trash2, Flag, CalendarDays, Pencil, ClipboardList, Sparkles } from "lucide-react";
import type { Role } from "./roles";
import { ROLES, TRADES } from "./roles";
import { useTeam, resolveName } from "./useTeam";
import api, { type ScheduleItemDto, type ProjectDto, type ChecklistDto } from "../../services/api";
import { checklistProgress } from "./Checklists";

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

type Row =
  | { kind: "group"; id: string; name: string; item?: ScheduleItemDto }
  | { kind: "item"; item: ScheduleItemDto }
  | { kind: "form"; id: string; name: string; start: string; end: string; percent: number };

const BAR: Record<string, string> = { not_started: "var(--ws-dashed)", in_progress: "var(--ws-primary)", done: "var(--ws-green)", blocked: "var(--ws-red)" };
const days = (a: string, b: string) => Math.max(1, Math.round((+d(b) - +d(a)) / DAY) + 1);

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
  const [mode, setMode] = useState<"gantt" | "list" | "milestones">("gantt");
  const [zoom, setZoom] = useState<"weeks" | "days">("weeks");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const p = await api.getProjects();
        const list = Array.isArray(p) ? p : [];
        setProjects(list);
        setProjectId((cur) => cur || list[0]?.id || "");
      } catch {
        setProjects([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const [itemsLoading, setItemsLoading] = useState(true);
  const load = () => {
    if (!projectId) { setItems([]); setChecklists([]); setItemsLoading(false); return; }
    setItemsLoading(true);
    Promise.all([
      api.getSchedule(projectId).catch(() => []),
      api.getChecklists({ projectId } as any).catch(() => []),
    ]).then(([s, c]) => {
      setItems(Array.isArray(s) ? s : []);
      setChecklists(Array.isArray(c) ? c : []);
    }).finally(() => setItemsLoading(false));
  };
  useEffect(load, [projectId]);

  // Assigned checklists with a due date, shown read-only on the same timeline.
  const overlay = useMemo(() => checklists.filter((c) => c.dueDate).map((c) => ({
    id: c.id, name: c.title, start: c.createdAt, end: c.dueDate as string,
    percent: c.reportedProgress != null ? c.reportedProgress : checklistProgress(c),
  })), [checklists]);

  const sorted = useMemo(() => [...items].sort((a, b) => (a.sortOrder - b.sortOrder) || (+d(a.startDate) - +d(b.startDate))), [items]);
  // Phases become group rows; the tasks after a phase sit under it.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const i of sorted) out.push(i.type === "phase" ? { kind: "group", id: i.id, name: i.name, item: i } : { kind: "item", item: i });
    if (overlay.length) {
      out.push({ kind: "group", id: "forms", name: "Assigned forms" });
      overlay.forEach((o) => out.push({ kind: "form", ...o }));
    }
    return out;
  }, [sorted, overlay]);

  // Timeline: whole programme, padded to whole weeks starting Monday.
  const range = useMemo(() => {
    const ds: number[] = [];
    items.forEach((i) => ds.push(+d(i.startDate), +d(i.endDate)));
    overlay.forEach((o) => ds.push(+d(o.start), +d(o.end)));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const min0 = new Date(ds.length ? Math.min(...ds, +today) : +today); min0.setHours(0, 0, 0, 0);
    min0.setDate(min0.getDate() - ((min0.getDay() + 6) % 7));
    let max = ds.length ? Math.max(...ds, +today) : +today + 56 * DAY;
    const weeks = Math.max(8, Math.ceil((max - +min0) / (7 * DAY)) + 1);
    max = +min0 + weeks * 7 * DAY;
    return { min: +min0, max, weeks };
  }, [items, overlay]);
  const pxDay = zoom === "weeks" ? 12 : 32;
  const width = range.weeks * 7 * pxDay;
  const x = (t: number) => ((t - range.min) / DAY) * pxDay;
  const todayX = x(Date.now());
  const weekCols = Array.from({ length: range.weeks }, (_, i) => range.min + i * 7 * DAY);
  const months = useMemo(() => {
    const out: { label: string; left: number; width: number }[] = [];
    const cur = new Date(range.min); cur.setDate(1);
    while (+cur < range.max) {
      const s = Math.max(+cur, range.min);
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const e = Math.min(+next, range.max);
      out.push({ label: cur.toLocaleDateString(undefined, { month: "long", year: "numeric" }), left: x(s), width: x(e) - x(s) });
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }, [range, pxDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToToday = () => scroller.current?.scrollTo({ left: Math.max(0, todayX - 200), behavior: "smooth" });
  useEffect(() => { if (mode === "gantt") requestAnimationFrame(scrollToToday); }, [mode, zoom, range.min]); // eslint-disable-line react-hooks/exhaustive-deps

  const milestones = sorted.filter((i) => i.type === "milestone");
  const activities = sorted.filter((i) => i.type !== "milestone" && i.type !== "phase");
  const start = sorted.length ? new Date(Math.min(...sorted.map((i) => +d(i.startDate)))) : null;
  const finish = sorted.length ? new Date(Math.max(...sorted.map((i) => +d(i.endDate)))) : null;

  async function remove(id: string) {
    if (!confirm("Delete this schedule item?")) return;
    try { await api.deleteScheduleItem(id); toast.success("Deleted"); load(); } catch { toast.error("Could not delete"); }
  }

  const ROW_H = 44;
  return (
    <div className="ws-page">
      <div className="ws-page-head">
        <div>
          <h1 className="ws-h1">Schedule</h1>
          <div className="ws-sub">The project programme: activities, phases and milestones against the calendar.</div>
        </div>
        <div className="ws-toolbar">
          <label className="sr-only" htmlFor="sch-project">Project</label>
          <select id="sch-project" className="ws-select" style={{ minWidth: 200 }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {canManage && projectId && <button type="button" className="ws-btn" onClick={() => setGenOpen(true)}><Sparkles aria-hidden /> AI schedule</button>}
          {canManage && projectId && <button type="button" className="ws-btn-primary" onClick={() => setEditing("new")}><Plus aria-hidden /> Add activity</button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="View" className="inline-flex rounded-lg p-0.5" style={{ border: "1px solid var(--ws-btn-border)", background: "var(--ws-card)" }}>
          {(["gantt", "list", "milestones"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className="h-8 px-3 rounded-md text-[13px] font-medium capitalize"
              style={mode === m ? { background: "var(--ws-ink)", color: "var(--ws-ink-text)" } : { color: "var(--ws-text-2)" }}>{m === "gantt" ? "Gantt" : m}</button>
          ))}
        </div>
        {mode === "gantt" && (
          <>
            <label className="sr-only" htmlFor="sch-zoom">Scale</label>
            <select id="sch-zoom" className="ws-select" value={zoom} onChange={(e) => setZoom(e.target.value as "weeks" | "days")}>
              <option value="weeks">Weeks</option>
              <option value="days">Days</option>
            </select>
            <button type="button" className="ws-btn" onClick={scrollToToday}>Today</button>
          </>
        )}
        <div className="flex-1" />
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" style={{ fontSize: 12.5, color: "var(--ws-muted)" }} aria-label="Legend">
          {Object.entries(STATUS).map(([k, v]) => <li key={k} className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm" style={{ background: BAR[k] }} aria-hidden />{v.label}</li>)}
          <li className="flex items-center gap-1.5"><span className="w-0.5 h-3" style={{ background: "var(--ws-ink)" }} aria-hidden />Today</li>
        </ul>
      </div>

      {loading || (projectId && itemsLoading) ? (
        <div className="ws-card ws-card-body ws-sub text-center py-14"><Loader2 className="w-4 h-4 animate-spin inline mr-1.5" /> Loading schedule…</div>
      ) : !projectId ? (
        <div className="ws-dashed-row text-center">Create a project first, then build its schedule here.</div>
      ) : items.length === 0 && overlay.length === 0 ? (
        <div className="ws-card ws-card-body">
          <div className="ws-dropzone">
            <CalendarDays className="w-7 h-7" style={{ color: "var(--ws-muted)" }} aria-hidden />
            <div className="ws-h2">No activities yet</div>
            <div className="ws-sub max-w-md">Add phases, activities and milestones with <strong>Add activity</strong>, or let AI schedule draft a programme you can edit.</div>
          </div>
        </div>
      ) : (
        <section className="ws-card overflow-hidden" aria-label="Programme">
          <div className="flex flex-wrap items-center justify-between gap-2 px-[18px] py-3" style={{ borderBottom: "1px solid var(--ws-divider)", fontSize: 13.5 }}>
            <span><strong style={{ fontWeight: 600 }}>{activities.length} activit{activities.length === 1 ? "y" : "ies"}</strong> · {milestones.length} milestone{milestones.length === 1 ? "" : "s"}{start && finish ? ` · ${fmt(start)} → ${fmt(finish)}` : ""}</span>
            {mode === "gantt" && <span className="ws-sub">Showing {range.weeks} weeks · Whole programme</span>}
          </div>

          {mode === "gantt" && (
            <div className="flex">
              {/* Left: names */}
              <div className="shrink-0 w-[150px] sm:w-[300px]" style={{ borderRight: "1px solid var(--ws-border)" }}>
                <div className="flex items-end px-3 pb-1.5" style={{ height: 52, borderBottom: "1px solid var(--ws-border)", fontSize: 12, color: "var(--ws-muted)" }}>Activity</div>
                {rows.map((r) => r.kind === "group" ? (
                  <div key={`g-${r.id}`} className="group flex items-center gap-2 px-3" style={{ height: 34, background: "var(--ws-hover)", borderBottom: "1px solid var(--ws-divider)", fontSize: 13, fontWeight: 600 }}>
                    <span className="truncate flex-1">{r.name}</span>
                    {r.item && canManage && <RowActions onEdit={() => setEditing(r.item!)} onDelete={() => remove(r.item!.id)} name={r.name} />}
                  </div>
                ) : r.kind === "form" ? (
                  <div key={`f-${r.id}`} className="flex items-center gap-2 px-3" style={{ height: ROW_H, borderBottom: "1px solid var(--ws-divider)" }}>
                    <ClipboardList className="w-4 h-4 shrink-0" style={{ color: "var(--ws-muted)" }} aria-hidden />
                    <span className="min-w-0 flex-1"><span className="block truncate" style={{ fontSize: 13.5 }}>{r.name}</span><span className="block" style={{ fontSize: 12, color: "var(--ws-muted)" }}>due {fmt(r.end)}</span></span>
                    <span style={{ fontSize: 12.5, color: "var(--ws-muted)" }}>{r.percent}%</span>
                  </div>
                ) : (
                  <div key={r.item.id} className="group flex items-center gap-2 px-3" style={{ height: ROW_H, borderBottom: "1px solid var(--ws-divider)" }}>
                    {r.item.type === "milestone" && <Flag className="w-3.5 h-3.5 shrink-0" aria-label="Milestone" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" style={{ fontSize: 13.5, fontWeight: 500 }} title={r.item.name}>{r.item.name}</span>
                      <span className="block truncate" style={{ fontSize: 12, color: "var(--ws-muted)" }}>
                        {r.item.type === "milestone" ? fmt(r.item.endDate) : `${fmt(r.item.startDate)} – ${fmt(r.item.endDate)} · ${days(r.item.startDate, r.item.endDate)}d`}
                      </span>
                    </span>
                    {canManage && <RowActions onEdit={() => setEditing(r.item)} onDelete={() => remove(r.item.id)} name={r.item.name} />}
                    {r.item.type !== "milestone" && <span style={{ fontSize: 12.5, color: r.item.status === "blocked" ? "var(--ws-red)" : "var(--ws-muted)", minWidth: 34, textAlign: "right" }}>{r.item.percent}%</span>}
                  </div>
                ))}
              </div>

              {/* Right: timeline */}
              <div ref={scroller} className="flex-1 overflow-x-auto">
                <div className="relative" style={{ width }}>
                  <div className="relative" style={{ height: 26 }}>
                    {months.map((m, i) => (
                      <div key={i} className="absolute top-0 h-full flex items-center px-2 truncate" style={{ left: m.left, width: m.width, borderLeft: "1px solid var(--ws-divider)", fontSize: 12, fontWeight: 600 }}>{m.label}</div>
                    ))}
                  </div>
                  <div className="relative" style={{ height: 26, borderBottom: "1px solid var(--ws-border)" }}>
                    {weekCols.map((w) => {
                      const current = Date.now() >= w && Date.now() < w + 7 * DAY;
                      return <div key={w} className="absolute top-0 h-full flex items-center px-1.5" style={{ left: x(w), width: 7 * pxDay, borderLeft: "1px solid var(--ws-divider)", fontSize: 11.5, color: current ? "var(--ws-primary-text)" : "var(--ws-muted)", fontWeight: current ? 600 : 400, background: current ? "var(--ws-wash)" : undefined }}>{new Date(w).getDate()} {new Date(w).toLocaleDateString(undefined, { month: "short" })}</div>;
                    })}
                  </div>
                  {/* grid + current week tint */}
                  <div className="absolute left-0 right-0 bottom-0" style={{ top: 52 }} aria-hidden>
                    {weekCols.map((w) => {
                      const current = Date.now() >= w && Date.now() < w + 7 * DAY;
                      return <div key={w} className="absolute top-0 bottom-0" style={{ left: x(w), width: 7 * pxDay, borderLeft: "1px solid var(--ws-divider)", background: current ? "var(--ws-wash)" : undefined }} />;
                    })}
                  </div>
                  {rows.map((r) => {
                    if (r.kind === "group") {
                      const it = r.item;
                      return (
                        <div key={`g-${r.id}`} className="relative" style={{ height: 34, background: "color-mix(in srgb, var(--ws-hover) 70%, transparent)", borderBottom: "1px solid var(--ws-divider)" }}>
                          {it && <div className="absolute rounded-sm" style={{ top: 15, height: 4, left: x(+d(it.startDate)), width: Math.max(4, x(+d(it.endDate) + DAY) - x(+d(it.startDate))), background: "var(--ws-ink)" }} title={`${it.name}: ${fmt(it.startDate)} – ${fmt(it.endDate)}`} />}
                        </div>
                      );
                    }
                    if (r.kind === "form") {
                      return (
                        <div key={`f-${r.id}`} className="relative" style={{ height: ROW_H, borderBottom: "1px solid var(--ws-divider)" }}>
                          <div className="absolute overflow-hidden" style={{ top: 11, height: 22, borderRadius: 6, left: x(+d(r.start)), width: Math.max(8, x(+d(r.end)) - x(+d(r.start))), border: "1px dashed var(--ws-blue)", background: "var(--ws-blue-bg)" }} title={`${r.name} · due ${fmt(r.end)} · ${r.percent}%`}>
                            <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, r.percent))}%`, background: "var(--ws-blue)", opacity: 0.35 }} />
                          </div>
                        </div>
                      );
                    }
                    const i = r.item;
                    if (i.type === "milestone") {
                      return (
                        <div key={i.id} className="relative" style={{ height: ROW_H, borderBottom: "1px solid var(--ws-divider)" }}>
                          <button type="button" onClick={() => canManage && setEditing(i)} aria-label={`Milestone ${i.name}, ${fmt(i.endDate)}`} className="absolute" style={{ top: ROW_H / 2 - 7, left: x(+d(i.endDate)) + pxDay / 2 - 7, width: 14, height: 14, background: "var(--ws-ink)", transform: "rotate(45deg)", borderRadius: 2 }} />
                          <span className="absolute whitespace-nowrap" style={{ top: ROW_H / 2 - 9, left: x(+d(i.endDate)) + pxDay / 2 + 12, fontSize: 12, color: "var(--ws-text-2)" }}>{i.name}</span>
                        </div>
                      );
                    }
                    const left = x(+d(i.startDate));
                    const w = Math.max(8, x(+d(i.endDate) + DAY) - left);
                    const blocked = i.status === "blocked";
                    const prog = i.status === "in_progress";
                    return (
                      <div key={i.id} className="relative" style={{ height: ROW_H, borderBottom: "1px solid var(--ws-divider)" }}>
                        <button type="button" onClick={() => canManage && setEditing(i)}
                          aria-label={`${i.name}: ${STATUS[i.status]?.label ?? i.status}, ${i.percent}% complete, ${fmt(i.startDate)} to ${fmt(i.endDate)}`}
                          className="absolute overflow-hidden text-left" style={{ top: 11, height: 22, borderRadius: 6, left, width: w, background: prog ? "var(--ws-track)" : BAR[i.status] ?? BAR.not_started }}>
                          {prog && <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, i.percent))}%`, background: "var(--ws-primary)" }} />}
                        </button>
                        {blocked && <span className="absolute whitespace-nowrap ws-pill ws-pill-red" style={{ top: 11, left: left + w + 6, height: 22 }}>Blocked</span>}
                      </div>
                    );
                  })}
                  {todayX >= 0 && todayX <= width && (
                    <div className="absolute bottom-0 z-10 pointer-events-none" style={{ top: 26, left: todayX, width: 2, background: "var(--ws-ink)" }}>
                      <span className="absolute -translate-x-1/2 whitespace-nowrap rounded px-1.5" style={{ top: 2, left: 1, fontSize: 11, fontWeight: 600, background: "var(--ws-ink)", color: "var(--ws-ink-text)" }}>Today · {fmt(Date.now())}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {mode !== "gantt" && (
            <div className="ws-table-wrap">
              <table className="ws-table">
                <thead><tr><th scope="col">{mode === "list" ? "Activity" : "Milestone"}</th><th scope="col">{mode === "list" ? "Dates" : "Date"}</th>{mode === "list" && <th scope="col">Complete</th>}<th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {(mode === "list" ? sorted : milestones).map((i) => (
                    <tr key={i.id}>
                      <td style={{ fontWeight: i.type === "phase" ? 600 : 500 }}>{i.name}</td>
                      <td className="whitespace-nowrap" style={{ color: "var(--ws-muted)" }}>{i.type === "milestone" ? fmt(i.endDate) : `${fmt(i.startDate)} – ${fmt(i.endDate)} · ${days(i.startDate, i.endDate)}d`}</td>
                      {mode === "list" && <td>{i.type === "milestone" ? "—" : `${i.percent}%`}</td>}
                      <td><span className={`ws-pill ${i.status === "done" ? "ws-pill-green" : i.status === "blocked" ? "ws-pill-red" : i.status === "in_progress" ? "ws-pill-amber" : ""}`}>{STATUS[i.status]?.label ?? i.status}</span></td>
                      <td className="text-right whitespace-nowrap">{canManage && <RowActions always onEdit={() => setEditing(i)} onDelete={() => remove(i.id)} name={i.name} />}</td>
                    </tr>
                  ))}
                  {(mode === "list" ? sorted : milestones).length === 0 && <tr><td colSpan={5} className="ws-sub">No {mode === "list" ? "activities" : "milestones"} yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {editing && projectId && (
        <ItemModal projectId={projectId} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
      {genOpen && projectId && (
        <GenerateModal projectId={projectId} onClose={() => setGenOpen(false)} onDone={() => { setGenOpen(false); load(); }} />
      )}
    </div>
  );
}

function RowActions({ onEdit, onDelete, name, always }: { onEdit: () => void; onDelete: () => void; name: string; always?: boolean }) {
  return (
    <span className={`flex items-center ${always ? "" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}>
      <button type="button" onClick={onEdit} className="ws-icon-btn ws-ghost" style={{ width: 26, height: 26 }} aria-label={`Edit ${name}`}><Pencil /></button>
      <button type="button" onClick={onDelete} className="ws-icon-btn ws-ghost" style={{ width: 26, height: 26 }} aria-label={`Delete ${name}`}><Trash2 /></button>
    </span>
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
            <div><span className={lbl}>Duration (weeks)</span><input placeholder="e.g. 16" type="number" min={1} max={260} value={weeks} onChange={(e) => setWeeks(Number(e.target.value) || 16)} className={cls} /></div>
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
            <div><span className={lbl}>% complete</span><input placeholder="e.g. 40" type="number" min={0} max={100} value={f.percent} onChange={(e) => set("percent", e.target.value)} className={cls} /></div>
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
          <div><span className={lbl}>Notes</span><textarea placeholder="e.g. Waiting on steel delivery" value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-2.5 py-2 text-[12.5px] text-white focus:outline-none focus:border-[#FF6B1A] resize-none" /></div>
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
