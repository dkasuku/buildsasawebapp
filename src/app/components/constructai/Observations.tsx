import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Search, X, Eye, MapPin, Camera, AlertTriangle, CheckCircle2, Clock, Trash2, Filter, ChevronDown, CheckSquare, Square, Circle, ListChecks } from "lucide-react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import ActionPlans from "./ActionPlans";
import { SectionTabs } from "./SectionTabs";
import { useTeam } from "./useTeam";
import api from "../../services/api";
import { EmptyState, ListSkeleton } from "./EmptyState";
import { ProjectSelect } from "./ProjectSelect";
import { warnSaveFailed } from "./saveFeedback";

// Reusable multi-assignee dropdown (light/dark safe). Stores selected member names.
function AssigneeSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const team = useTeam();
  const members = team;
  const toggle = (n: string) => onChange(value.includes(n) ? value.filter((x) => x !== n) : [...value, n]);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="w-full min-h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 py-1.5 text-left flex flex-wrap gap-1 items-center">
        {value.length === 0 && <span className="text-[12px] text-[#5B6675]">Select assignee(s)…</span>}
        {value.map((n) => <span key={n} className="text-[11px] px-1.5 py-0.5 rounded bg-[#FF6B1A]/15 text-[#FF6B1A] flex items-center gap-1">{n}<span onClick={(e) => { e.stopPropagation(); toggle(n); }}><X className="w-3 h-3" /></span></span>)}
        <ChevronDown className="w-3.5 h-3.5 text-[#5B6675] ml-auto" />
      </button>
      {open && (<>
        <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-[#222A35] bg-[#11161D] shadow-xl py-1">
          {members.length === 0 && <div className="px-3 py-2 text-[11px] text-[#5B6675]">No teammates yet — invite people on the Team page.</div>}
          {members.map((m) => (
            <button key={m.id} type="button" onClick={() => toggle(m.name)} className="w-full px-3 py-1.5 text-left text-[12px] flex items-center gap-2 hover:bg-[#161C24]">
              {value.includes(m.name) ? <CheckSquare className="w-3.5 h-3.5 text-[#FF6B1A]" /> : <Square className="w-3.5 h-3.5 text-[#5B6675]" />}
              <span className="text-white">{m.name}</span><span className="text-[10px] text-[#5B6675] ml-auto">{m.role}</span>
            </button>
          ))}
        </div>
      </>)}
    </div>
  );
}

/** A short, readable reference for a record id (OBS-7F3K2). */
const ref = (id: string) => (id.length > 12 ? `OBS-${id.slice(-5).toUpperCase()}` : id);

const mapObs = (r: any): Observation => ({
  id: r.id, title: r.title, type: r.type, status: r.status, priority: r.priority,
  location: r.location || "", project: r.project || "", projectId: r.projectId || "", assignee: r.assignee || "",
  date: r.date || "", description: r.description || "", photos: r.photos || 0,
});

type Observation = {
  id: string;
  title: string;
  type: "Quality" | "Safety" | "Environmental" | "Commissioning";
  status: "open" | "in_review" | "closed";
  priority: "low" | "medium" | "high";
  location: string;
  /** Display name of the linked project. */
  project: string;
  /** Durable link to the real project row. */
  projectId: string;
  assignee: string;
  date: string;
  description: string;
  photos: number;
};

const STATUS_META: Record<Observation["status"], { label: string; cls: string; icon: any }> = {
  open: { label: "Open", cls: "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30", icon: AlertTriangle },
  in_review: { label: "In Review", cls: "bg-[#F5A623]/15 text-[#F5A623] border-[#F5A623]/30", icon: Clock },
  closed: { label: "Closed", cls: "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30", icon: CheckCircle2 },
};

const TYPE_COLORS: Record<Observation["type"], string> = {
  Quality: "#3B82F6", Safety: "#EF4444", Environmental: "#22C55E", Commissioning: "#A855F7",
};

const PRIORITY_CLS: Record<Observation["priority"], string> = {
  low: "text-[#8A95A5]", medium: "text-[#F5A623]", high: "text-[#EF4444]",
};

// Observations and their corrective actions behind one sidebar entry. Action
// plans only ever existed to fix an observation (or another site issue), so
// they are a tab here, and each observation shows and adds its own.
export default function Observations({ role, initialTab = "observations" }: { role: Role; initialTab?: "observations" | "actions" }) {
  const canSeeActions = (ROLES[role]?.views || []).includes("action-plans");
  const [tab, setTab] = useState<"observations" | "actions">(canSeeActions ? initialTab : "observations");
  return (
    <div>
      {canSeeActions && (
        <SectionTabs<"observations" | "actions">
          tabs={[{ key: "observations", label: "Observations" }, { key: "actions", label: "Corrective actions" }]}
          value={tab}
          onChange={setTab}
        />
      )}
      {tab === "observations" ? <ObservationList role={role} canSeeActions={canSeeActions} /> : <ActionPlans role={role} />}
    </div>
  );
}

function ObservationList({ role, canSeeActions }: { role: Role; canSeeActions: boolean }) {
  const [items, setItems] = useState<Observation[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState<Observation | null>(null);

  // Load persisted observations; the API response is authoritative (including empty)
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      try { setItems(((await api.getObservations()) ?? []).map(mapObs)); }
      catch { /* offline — leave list empty */ }
      finally { setLoaded(true); }
    })();
  }, []);

  const filtered = useMemo(() => items.filter((o) => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (typeFilter !== "all" && o.type !== typeFilter) return false;
    if (q && !`${o.title} ${o.id} ${o.location} ${o.project} ${o.assignee}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [items, q, statusFilter, typeFilter]);

  const counts = useMemo(() => ({
    open: items.filter((o) => o.status === "open").length,
    in_review: items.filter((o) => o.status === "in_review").length,
    closed: items.filter((o) => o.status === "closed").length,
  }), [items]);

  const setStatus = (id: string, status: Observation["status"]) => {
    setItems((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    setDetail((d) => (d && d.id === id ? { ...d, status } : d));
    toast.success(`Observation ${ref(id)} marked ${STATUS_META[status].label}`);
    api.updateObservation(id, { status }).catch(warnSaveFailed("observation update"));
  };

  const remove = (id: string) => {
    setItems((prev) => prev.filter((o) => o.id !== id));
    setDetail(null);
    toast.success(`Observation ${ref(id)} deleted`);
    api.deleteObservation(id).catch(warnSaveFailed("observation deletion"));
  };

  return (
    <div className="px-4 sm:px-7 py-6">
      <div className="grid grid-cols-3 gap-3 mb-5">
        {(["open", "in_review", "closed"] as const).map((s) => {
          const M = STATUS_META[s];
          return (
            <button key={s} onClick={() => setStatusFilter(statusFilter === s ? "all" : s)} className={`rounded-xl border p-4 text-left transition ${statusFilter === s ? "border-[#FF6B1A] bg-[#FF6B1A]/5" : "border-[#222A35] bg-[#11161D] hover:border-[#2E3947]"}`}>
              <div className="flex items-center gap-2"><M.icon className="w-4 h-4 text-[#8A95A5]" /><span className="text-[11px] text-[#8A95A5] uppercase tracking-wider">{M.label}</span></div>
              <div className="text-[22px] text-white mt-1">{counts[s]}</div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B6675]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search observations…" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg pl-9 pr-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
        </div>
        <div className="flex items-center gap-1.5 h-9 px-3 bg-[#11161D] border border-[#222A35] rounded-lg">
          <Filter className="w-3.5 h-3.5 text-[#5B6675]" />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="bg-transparent text-[12px] text-white focus:outline-none">
            <option value="all">All Types</option>
            {Object.keys(TYPE_COLORS).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button onClick={() => setShowNew(true)} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New Observation</button>
      </div>

      <div className="space-y-2">
        {!loaded && <ListSkeleton />}
        {loaded && filtered.length === 0 && (
          <EmptyState
            icon={Eye}
            title="No observations yet"
            description="Log your first quality, safety or environmental observation to start tracking site issues."
            actionLabel="New Observation"
            onAction={() => setShowNew(true)}
          />
        )}
        {filtered.map((o) => {
          const M = STATUS_META[o.status];
          return (
            <button key={o.id} onClick={() => setDetail(o)} className="w-full text-left bg-[#11161D] border border-[#222A35] rounded-xl p-4 hover:border-[#2E3947] transition flex items-start gap-3">
              <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_COLORS[o.type] }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-[#5B6675]">{ref(o.id)}</span>
                  <span className="text-[13px] text-white">{o.title}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-[#8A95A5] flex-wrap">
                  <span style={{ color: TYPE_COLORS[o.type] }}>{o.type}</span>
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {o.location}</span>
                  <span>{o.project}</span>
                  <span className={PRIORITY_CLS[o.priority]}>{o.priority} priority</span>
                  <span className="flex items-center gap-1"><Camera className="w-3 h-3" /> {o.photos}</span>
                </div>
              </div>
              <span className={`shrink-0 text-[10px] px-2 py-1 rounded-full border ${M.cls}`}>{M.label}</span>
            </button>
          );
        })}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-[11px] text-[#5B6675]">{ref(detail.id)} · {detail.date}</div>
                <h3 className="text-[15px] text-white mt-0.5">{detail.title}</h3>
              </div>
              <button onClick={() => setDetail(null)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <span className={`inline-block text-[10px] px-2 py-1 rounded-full border ${STATUS_META[detail.status].cls}`}>{STATUS_META[detail.status].label}</span>
            <p className="text-[13px] text-[#B8C0CC] mt-3">{detail.description}</p>
            <div className="grid grid-cols-2 gap-3 mt-4 text-[12px]">
              <div><div className="text-[#5B6675] text-[10px] uppercase">Type</div><div style={{ color: TYPE_COLORS[detail.type] }}>{detail.type}</div></div>
              <div><div className="text-[#5B6675] text-[10px] uppercase">Priority</div><div className={PRIORITY_CLS[detail.priority]}>{detail.priority}</div></div>
              <div><div className="text-[#5B6675] text-[10px] uppercase">Location</div><div className="text-white">{detail.location}</div></div>
              <div><div className="text-[#5B6675] text-[10px] uppercase">Project</div><div className="text-white">{detail.project}</div></div>
              <div><div className="text-[#5B6675] text-[10px] uppercase">Assignee</div><div className="text-white">{detail.assignee}</div></div>
              <div><div className="text-[#5B6675] text-[10px] uppercase">Photos</div><div className="text-white">{detail.photos} attached</div></div>
            </div>
            {canSeeActions && <CorrectiveActions observation={detail} />}
            <div className="flex flex-wrap gap-2 mt-5">
              {detail.status !== "in_review" && <button onClick={() => setStatus(detail.id, "in_review")} className="h-8 px-3 bg-[#F5A623]/15 text-[#F5A623] border border-[#F5A623]/30 rounded-lg text-[11px]">Send to Review</button>}
              {detail.status !== "closed" && <button onClick={() => setStatus(detail.id, "closed")} className="h-8 px-3 bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30 rounded-lg text-[11px]">Close Observation</button>}
              {detail.status === "closed" && <button onClick={() => setStatus(detail.id, "open")} className="h-8 px-3 bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30 rounded-lg text-[11px]">Reopen</button>}
              <button onClick={() => remove(detail.id)} className="h-8 px-3 bg-[#222A35] text-[#EF4444] rounded-lg text-[11px] flex items-center gap-1 ml-auto"><Trash2 className="w-3 h-3" /> Delete</button>
            </div>
          </div>
        </div>
      )}

      {showNew && <NewObservationModal onClose={() => setShowNew(false)} onCreate={async (o) => {
        setItems((prev) => [o, ...prev]);
        toast.success(`Observation ${o.id} created`);
        try {
          const saved = await api.createObservation({ title: o.title, type: o.type, status: o.status, priority: o.priority, location: o.location, project: o.project, projectId: o.projectId || null, assignee: o.assignee, date: o.date, description: o.description, photos: o.photos });
          setItems((prev) => prev.map((x) => x.id === o.id ? mapObs(saved) : x));
        } catch (e: any) {
          toast.error(`Saved locally only — ${e?.message || "the server rejected it"}`, { duration: 8000 });
        }
      }} />}
    </div>
  );
}

function NewObservationModal({ onClose, onCreate }: { onClose: () => void; onCreate: (o: Observation) => void }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<Observation["type"]>("Quality");
  const [priority, setPriority] = useState<Observation["priority"]>("medium");
  const [location, setLocation] = useState("");
  // Real projects, replacing the three hardcoded demo names that were saved as
  // a project reference matching nothing.
  const [project, setProject] = useState<{ id: string; name: string } | null>(null);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [description, setDescription] = useState("");

  const submit = () => {
    if (!title.trim()) { toast.error("Title is required"); return; }
    if (!project) { toast.error("Select the project this observation is on"); return; }
    onCreate({
      id: `OBS-${100 + Math.floor(Math.random() * 900)}`,
      title: title.trim(), type, status: "open", priority,
      location: location.trim() || "Unspecified", project: project.name, projectId: project.id,
      assignee: assignees.join(", ") || "Unassigned",
      date: new Date().toISOString().slice(0, 10),
      description: description.trim(), photos: 0,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-white flex items-center gap-2"><Eye className="w-4 h-4 text-[#FF6B1A]" /> New Observation</h3>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Observation title" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
          <div className="grid grid-cols-2 gap-3">
            <select value={type} onChange={(e) => setType(e.target.value as Observation["type"])} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">
              {Object.keys(TYPE_COLORS).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={priority} onChange={(e) => setPriority(e.target.value as Observation["priority"])} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">
              <option value="low">Low priority</option><option value="medium">Medium priority</option><option value="high">High priority</option>
            </select>
          </div>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (e.g. Level 2 — Grid C4)" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
          <ProjectSelect value={project?.id} onChange={setProject} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Assignees (multiple allowed)</div>
            <AssigneeSelect value={assignees} onChange={setAssignees} />
          </div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description…" rows={3} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A] resize-none" />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="h-9 px-4 bg-[#222A35] rounded-lg text-[12px] text-white">Cancel</button>
          <button onClick={submit} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium">Create Observation</button>
        </div>
      </div>
    </div>
  );
}

// ── Corrective actions on one observation ────────────────────────────────────
// Stored as action plans whose source is the observation's id, so they also
// appear in the Corrective actions tab with every other plan.
type Step = { id: string; text: string; done: boolean };
type Plan = { id: string; title: string; owner: string; due: string; status: string; items: Step[] };
const toPlan = (r: any): Plan => ({ id: r.id, title: r.title, owner: r.owner || "", due: r.due || "", status: r.status, items: (() => { try { return JSON.parse(r.items || "[]"); } catch { return []; } })() });

function CorrectiveActions({ observation }: { observation: Observation }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [steps, setSteps] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getActionPlans().then((rows: any[]) => setPlans((rows || []).filter((r) => r.source === observation.id).map(toPlan))).catch(() => setPlans([]));
  }, [observation.id]);

  const toggle = (plan: Plan, stepId: string) => {
    const items = plan.items.map((i) => (i.id === stepId ? { ...i, done: !i.done } : i));
    const status = items.every((i) => i.done) ? "completed" : (plan.due && new Date(plan.due) < new Date() ? "overdue" : "active");
    setPlans((ps) => (ps || []).map((p) => (p.id === plan.id ? { ...p, items, status } : p)));
    api.updateActionPlan(plan.id, { items, status }).catch(warnSaveFailed("corrective action update"));
  };

  const add = async () => {
    const items = steps.map((t, i) => ({ id: `i${i + 1}`, text: t.trim(), done: false })).filter((i) => i.text);
    if (!items.length) { toast.error("Add at least one step"); return; }
    setBusy(true);
    try {
      const saved = await api.createActionPlan({
        title: `Fix: ${observation.title}`, source: observation.id, owner: owner.trim() || observation.assignee || "Unassigned",
        due: due || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), status: "active",
        project: observation.project, projectId: observation.projectId || null, items,
      });
      setPlans((ps) => [...(ps || []), toPlan(saved)]);
      setAdding(false); setOwner(""); setDue(""); setSteps([""]);
      toast.success("Corrective action added");
    } catch (e: any) { toast.error(e?.message || "Could not save the corrective action"); }
    finally { setBusy(false); }
  };

  const all = (plans || []).flatMap((p) => p.items);
  const done = all.filter((i) => i.done).length;
  const field = "h-8 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2.5 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]";

  return (
    <div className="mt-5 pt-4 border-t border-[#222A35]">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] text-white flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5 text-[#FF6B1A]" /> Corrective actions {all.length > 0 && <span className="text-[#8A95A5]">· {done}/{all.length} done</span>}</div>
        {!adding && <button onClick={() => setAdding(true)} className="text-[11px] text-[#FF6B1A] hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button>}
      </div>
      {plans === null && <div className="text-[11px] text-[#5B6675]">Loading…</div>}
      {plans && plans.length === 0 && !adding && <div className="text-[11px] text-[#5B6675]">No corrective actions yet. Add the steps needed to fix this, with an owner and a due date.</div>}
      <div className="space-y-2">
        {(plans || []).map((p) => (
          <div key={p.id} className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-2.5">
            <div className="text-[10.5px] text-[#8A95A5] mb-1">{p.owner} · due {p.due}{p.status === "overdue" && <span className="text-[#EF4444]"> · overdue</span>}</div>
            {p.items.map((i) => (
              <button key={i.id} onClick={() => toggle(p, i.id)} className="w-full flex items-center gap-2 py-1 text-left">
                {i.done ? <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" /> : <Circle className="w-4 h-4 text-[#5B6675] shrink-0" />}
                <span className={`text-[12px] ${i.done ? "text-[#5B6675] line-through" : "text-white"}`}>{i.text}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {adding && (
        <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3 space-y-2 mt-2">
          {steps.map((st, i) => (
            <div key={i} className="flex gap-2">
              <input value={st} onChange={(e) => setSteps((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} placeholder={i === 0 ? "e.g. Remove and re-fix loose tiles" : `Step ${i + 1}`} className={`${field} flex-1`} />
              {steps.length > 1 && <button onClick={() => setSteps((xs) => xs.filter((_, j) => j !== i))} className="text-[#8A95A5] hover:text-red-400"><X className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
          <button onClick={() => setSteps((xs) => [...xs, ""])} className="text-[11px] text-[#FF6B1A] flex items-center gap-1"><Plus className="w-3 h-3" /> Another step</button>
          <div className="grid grid-cols-2 gap-2">
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder={observation.assignee && observation.assignee !== "Unassigned" ? observation.assignee : "Who fixes it"} className={field} />
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="h-8 px-3 bg-[#222A35] rounded-lg text-[11px] text-white">Cancel</button>
            <button onClick={add} disabled={busy} className="h-8 px-3 bg-[#FF6B1A] text-black rounded-lg text-[11px] font-medium disabled:opacity-60">{busy ? "Saving…" : "Save actions"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
