import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Search, X, Eye, MapPin, Camera, AlertTriangle, CheckCircle2, Clock, Trash2, Filter, ChevronDown, CheckSquare, Square } from "lucide-react";
import type { Role } from "./roles";
import { TEAM_MEMBERS } from "./team-data";
import { useTeam } from "./useTeam";
import api from "../../services/api";

// Reusable multi-assignee dropdown (light/dark safe). Stores selected member names.
function AssigneeSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const team = useTeam();
  const members = team.length ? team : TEAM_MEMBERS; // real users, demo fallback if none invited yet
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

const mapObs = (r: any): Observation => ({
  id: r.id, title: r.title, type: r.type, status: r.status, priority: r.priority,
  location: r.location || "", project: r.project || "", assignee: r.assignee || "",
  date: r.date || "", description: r.description || "", photos: r.photos || 0,
});

type Observation = {
  id: string;
  title: string;
  type: "Quality" | "Safety" | "Environmental" | "Commissioning";
  status: "open" | "in_review" | "closed";
  priority: "low" | "medium" | "high";
  location: string;
  project: string;
  assignee: string;
  date: string;
  description: string;
  photos: number;
};

const SEED: Observation[] = [
  { id: "OBS-101", title: "Exposed rebar at column C4 not covered", type: "Safety", status: "open", priority: "high", location: "Level 2 — Grid C4", project: "Westside Tower", assignee: "James Mwangi", date: "2026-06-10", description: "Rebar protruding from column formwork without protective caps. Risk of impalement injury.", photos: 2 },
  { id: "OBS-102", title: "Honeycombing on slab soffit", type: "Quality", status: "in_review", priority: "medium", location: "Level 1 — Zone B", project: "Westside Tower", assignee: "Grace Njeri", date: "2026-06-09", description: "Visible honeycombing on slab soffit after formwork removal. Needs repair method statement.", photos: 3 },
  { id: "OBS-103", title: "Silt runoff into storm drain", type: "Environmental", status: "open", priority: "medium", location: "Site perimeter — East", project: "Riverside Mall", assignee: "Peter Otieno", date: "2026-06-08", description: "Silt fence damaged, sediment entering municipal storm drain after rains.", photos: 1 },
  { id: "OBS-104", title: "AHU vibration isolators missing", type: "Commissioning", status: "closed", priority: "low", location: "Roof plant room", project: "Riverside Mall", assignee: "Mary Wanjiku", date: "2026-06-05", description: "AHU-02 installed without spring isolators per spec section 23 05 48. Now corrected.", photos: 2 },
  { id: "OBS-105", title: "Scaffold missing toe boards", type: "Safety", status: "closed", priority: "high", location: "North elevation", project: "Westside Tower", assignee: "James Mwangi", date: "2026-06-03", description: "Toe boards absent on working platform level 3. Corrected same day.", photos: 1 },
];

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

export default function Observations({ role }: { role: Role }) {
  const [items, setItems] = useState<Observation[]>(SEED);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState<Observation | null>(null);

  // Load persisted observations; keep SEED only if the backend is unreachable
  useEffect(() => {
    (async () => {
      try { setItems((await api.getObservations()).map(mapObs)); }
      catch { /* offline — keep SEED */ }
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
    toast.success(`Observation ${id} marked ${STATUS_META[status].label}`);
    api.updateObservation(id, { status }).catch(() => { /* offline */ });
  };

  const remove = (id: string) => {
    setItems((prev) => prev.filter((o) => o.id !== id));
    setDetail(null);
    toast.success(`Observation ${id} deleted`);
    api.deleteObservation(id).catch(() => { /* offline */ });
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
        {filtered.length === 0 && <div className="text-center text-[13px] text-[#5B6675] py-10">No observations match your filters.</div>}
        {filtered.map((o) => {
          const M = STATUS_META[o.status];
          return (
            <button key={o.id} onClick={() => setDetail(o)} className="w-full text-left bg-[#11161D] border border-[#222A35] rounded-xl p-4 hover:border-[#2E3947] transition flex items-start gap-3">
              <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_COLORS[o.type] }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-[#5B6675]">{o.id}</span>
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
                <div className="text-[11px] text-[#5B6675]">{detail.id} · {detail.date}</div>
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
          const saved = await api.createObservation({ title: o.title, type: o.type, status: o.status, priority: o.priority, location: o.location, project: o.project, assignee: o.assignee, date: o.date, description: o.description, photos: o.photos });
          setItems((prev) => prev.map((x) => x.id === o.id ? mapObs(saved) : x));
        } catch { /* offline — keep local */ }
      }} />}
    </div>
  );
}

function NewObservationModal({ onClose, onCreate }: { onClose: () => void; onCreate: (o: Observation) => void }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<Observation["type"]>("Quality");
  const [priority, setPriority] = useState<Observation["priority"]>("medium");
  const [location, setLocation] = useState("");
  const [project, setProject] = useState("Westside Tower");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [description, setDescription] = useState("");

  const submit = () => {
    if (!title.trim()) { toast.error("Title is required"); return; }
    onCreate({
      id: `OBS-${100 + Math.floor(Math.random() * 900)}`,
      title: title.trim(), type, status: "open", priority,
      location: location.trim() || "Unspecified", project,
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
          <select value={project} onChange={(e) => setProject(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">
            <option>Westside Tower</option><option>Riverside Mall</option><option>Hilltop Residences</option>
          </select>
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
