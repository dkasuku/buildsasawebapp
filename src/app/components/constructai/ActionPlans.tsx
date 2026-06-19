import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Search, X, ClipboardCheck, CheckCircle2, Circle, Trash2, CalendarDays, User } from "lucide-react";
import type { Role } from "./roles";
import api from "../../services/api";

const mapPlan = (r: any): ActionPlan => ({
  id: r.id, title: r.title, source: r.source || "", owner: r.owner || "", due: r.due || "",
  status: r.status, project: r.project || "",
  items: (() => { try { return JSON.parse(r.items || "[]"); } catch { return []; } })(),
});

type PlanItem = { id: string; text: string; done: boolean };
type ActionPlan = {
  id: string;
  title: string;
  source: string;
  owner: string;
  due: string;
  status: "active" | "completed" | "overdue";
  project: string;
  items: PlanItem[];
};

const SEED: ActionPlan[] = [
  {
    id: "AP-201", title: "Rectify honeycombing — Level 1 slab", source: "OBS-102", owner: "Grace Njeri", due: "2026-06-18", status: "active", project: "Westside Tower",
    items: [
      { id: "i1", text: "Submit repair method statement to Engineer", done: true },
      { id: "i2", text: "Chip out loose concrete & clean surface", done: true },
      { id: "i3", text: "Apply approved repair mortar", done: false },
      { id: "i4", text: "Engineer inspection & sign-off", done: false },
    ],
  },
  {
    id: "AP-202", title: "Restore silt fencing — East perimeter", source: "OBS-103", owner: "Peter Otieno", due: "2026-06-12", status: "overdue", project: "Riverside Mall",
    items: [
      { id: "i1", text: "Procure replacement silt fence rolls", done: true },
      { id: "i2", text: "Install fence along damaged section", done: false },
      { id: "i3", text: "Clear sediment from storm drain inlet", done: false },
    ],
  },
  {
    id: "AP-203", title: "Scaffold safety compliance sweep", source: "Safety audit W23", owner: "James Mwangi", due: "2026-06-08", status: "completed", project: "Westside Tower",
    items: [
      { id: "i1", text: "Inspect all scaffold platforms for toe boards", done: true },
      { id: "i2", text: "Replace missing guardrails", done: true },
      { id: "i3", text: "Tag all compliant scaffolds", done: true },
    ],
  },
];

const STATUS_META: Record<ActionPlan["status"], { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/30" },
  completed: { label: "Completed", cls: "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30" },
  overdue: { label: "Overdue", cls: "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30" },
};

export default function ActionPlans({ role }: { role: Role }) {
  const [plans, setPlans] = useState<ActionPlan[]>(SEED);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [showNew, setShowNew] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(SEED[0]?.id ?? null);

  // Load persisted plans; keep SEED only if the backend is unreachable
  useEffect(() => {
    (async () => {
      try { setPlans((await api.getActionPlans()).map(mapPlan)); }
      catch { /* offline — keep SEED */ }
    })();
  }, []);

  const filtered = useMemo(() => plans.filter((p) => {
    if (filter !== "all" && p.status !== filter) return false;
    if (q && !`${p.title} ${p.id} ${p.owner} ${p.project}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [plans, q, filter]);

  const toggleItem = (planId: string, itemId: string) => {
    let persist: { items: PlanItem[]; status: ActionPlan["status"] } | null = null;
    setPlans((prev) => prev.map((p) => {
      if (p.id !== planId) return p;
      const items = p.items.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i));
      const allDone = items.every((i) => i.done);
      const status: ActionPlan["status"] = allDone ? "completed" : (new Date(p.due) < new Date() ? "overdue" : "active");
      if (allDone && p.status !== "completed") toast.success(`${p.id} completed 🎉`);
      persist = { items, status };
      return { ...p, items, status };
    }));
    if (persist) api.updateActionPlan(planId, persist).catch(() => { /* offline */ });
  };

  const removePlan = (id: string) => {
    setPlans((prev) => prev.filter((p) => p.id !== id));
    toast.success(`Action plan ${id} deleted`);
    api.deleteActionPlan(id).catch(() => { /* offline */ });
  };

  return (
    <div className="px-4 sm:px-7 py-6">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B6675]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search action plans…" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg pl-9 pr-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
        </div>
        <div className="flex gap-1">
          {["all", "active", "overdue", "completed"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`h-9 px-3 rounded-lg text-[12px] capitalize transition ${filter === f ? "bg-[#FF6B1A] text-black font-medium" : "bg-[#11161D] border border-[#222A35] text-[#8A95A5] hover:text-white"}`}>{f}</button>
          ))}
        </div>
        <button onClick={() => setShowNew(true)} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New Plan</button>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 && <div className="text-center text-[13px] text-[#5B6675] py-10">No action plans match your filters.</div>}
        {filtered.map((p) => {
          const doneCount = p.items.filter((i) => i.done).length;
          const pct = p.items.length ? Math.round((doneCount / p.items.length) * 100) : 0;
          const isOpen = expanded === p.id;
          return (
            <div key={p.id} className="bg-[#11161D] border border-[#222A35] rounded-xl overflow-hidden">
              <button onClick={() => setExpanded(isOpen ? null : p.id)} className="w-full text-left p-4 hover:bg-[#161C24]/50 transition">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-[#5B6675]">{p.id}</span>
                  <span className="text-[13px] text-white flex-1">{p.title}</span>
                  <span className={`text-[10px] px-2 py-1 rounded-full border ${STATUS_META[p.status].cls}`}>{STATUS_META[p.status].label}</span>
                </div>
                <div className="flex items-center gap-3 mt-2 text-[11px] text-[#8A95A5] flex-wrap">
                  <span className="flex items-center gap-1"><User className="w-3 h-3" /> {p.owner}</span>
                  <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" /> Due {p.due}</span>
                  <span>{p.project}</span>
                  <span className="text-[#5B6675]">From: {p.source}</span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-[#222A35] overflow-hidden">
                    <div className="h-full rounded-full bg-[#FF6B1A] transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[11px] text-[#8A95A5]">{doneCount}/{p.items.length}</span>
                </div>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 border-t border-[#222A35] pt-3">
                  <div className="space-y-1.5">
                    {p.items.map((i) => (
                      <button key={i.id} onClick={() => toggleItem(p.id, i.id)} className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[#161C24] transition text-left">
                        {i.done ? <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" /> : <Circle className="w-4 h-4 text-[#5B6675] shrink-0" />}
                        <span className={`text-[12px] ${i.done ? "text-[#5B6675] line-through" : "text-white"}`}>{i.text}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-end mt-3">
                    <button onClick={() => removePlan(p.id)} className="h-8 px-3 bg-[#222A35] text-[#EF4444] rounded-lg text-[11px] flex items-center gap-1"><Trash2 className="w-3 h-3" /> Delete plan</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showNew && <NewPlanModal onClose={() => setShowNew(false)} onCreate={async (p) => {
        setPlans((prev) => [p, ...prev]);
        setExpanded(p.id);
        toast.success(`Action plan ${p.id} created`);
        try {
          const saved = await api.createActionPlan({ title: p.title, source: p.source, owner: p.owner, due: p.due, status: p.status, project: p.project, items: p.items });
          setPlans((prev) => prev.map((x) => x.id === p.id ? mapPlan(saved) : x));
          setExpanded((e) => e === p.id ? saved.id : e);
        } catch { /* offline — keep local */ }
      }} />}
    </div>
  );
}

function NewPlanModal({ onClose, onCreate }: { onClose: () => void; onCreate: (p: ActionPlan) => void }) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [project, setProject] = useState("Westside Tower");
  const [source, setSource] = useState("");
  const [steps, setSteps] = useState<string[]>([""]);

  const submit = () => {
    if (!title.trim()) { toast.error("Title is required"); return; }
    const items = steps.map((s, i) => ({ id: `i${i + 1}`, text: s.trim(), done: false })).filter((i) => i.text);
    if (items.length === 0) { toast.error("Add at least one step"); return; }
    onCreate({
      id: `AP-${200 + Math.floor(Math.random() * 800)}`,
      title: title.trim(), owner: owner.trim() || "Unassigned",
      due: due || new Date().toISOString().slice(0, 10),
      status: "active", project, source: source.trim() || "Manual", items,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-white flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-[#FF6B1A]" /> New Action Plan</h3>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Plan title" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
          <div className="grid grid-cols-2 gap-3">
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Owner" className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select value={project} onChange={(e) => setProject(e.target.value)} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">
              <option>Westside Tower</option><option>Riverside Mall</option><option>Hilltop Residences</option>
            </select>
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source (e.g. OBS-102)" className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
          </div>
          <div className="text-[11px] text-[#8A95A5]">Steps</div>
          {steps.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input value={s} onChange={(e) => setSteps((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Step ${i + 1}`} className="flex-1 h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" />
              {steps.length > 1 && <button onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))} className="text-[#EF4444]"><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
          <button onClick={() => setSteps((prev) => [...prev, ""])} className="text-[12px] text-[#FF6B1A] flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add step</button>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="h-9 px-4 bg-[#222A35] rounded-lg text-[12px] text-white">Cancel</button>
          <button onClick={submit} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium">Create Plan</button>
        </div>
      </div>
    </div>
  );
}
