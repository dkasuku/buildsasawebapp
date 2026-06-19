import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Search, X, UsersRound, HardHat, MapPin, Trash2, UserPlus, ChevronDown, ChevronRight } from "lucide-react";
import type { Role } from "./roles";
import api from "../../services/api";

const mapCrew = (r: any): Crew => ({
  id: r.id, name: r.name, trade: r.trade || "", foreman: r.foreman || "", project: r.project || "",
  location: r.location || "", shift: r.shift, status: r.status,
  members: (() => { try { return JSON.parse(r.members || "[]"); } catch { return []; } })(),
});

type CrewMember = { id: string; name: string; trade: string };
type Crew = {
  id: string;
  name: string;
  trade: string;
  foreman: string;
  project: string;
  location: string;
  shift: "Day" | "Night";
  status: "on_site" | "off_site" | "on_leave";
  members: CrewMember[];
};

const SEED: Crew[] = [
  {
    id: "CRW-01", name: "Concrete Crew A", trade: "Concrete & Formwork", foreman: "James Mwangi", project: "Westside Tower", location: "Level 3 — Zone A", shift: "Day", status: "on_site",
    members: [
      { id: "m1", name: "Samuel Kiprop", trade: "Formwork Carpenter" },
      { id: "m2", name: "Daniel Omondi", trade: "Steel Fixer" },
      { id: "m3", name: "John Kamau", trade: "Concrete Finisher" },
      { id: "m4", name: "Brian Mutua", trade: "General Labourer" },
    ],
  },
  {
    id: "CRW-02", name: "Electrical Crew 1", trade: "Electrical", foreman: "Grace Njeri", project: "Westside Tower", location: "Level 1 — Risers", shift: "Day", status: "on_site",
    members: [
      { id: "m1", name: "Kevin Ochieng", trade: "Electrician" },
      { id: "m2", name: "Felix Wafula", trade: "Electrician" },
      { id: "m3", name: "Moses Kilonzo", trade: "Apprentice" },
    ],
  },
  {
    id: "CRW-03", name: "Plumbing Crew", trade: "Plumbing & Drainage", foreman: "Peter Otieno", project: "Riverside Mall", location: "Basement — Plant room", shift: "Day", status: "off_site",
    members: [
      { id: "m1", name: "Anthony Njoroge", trade: "Plumber" },
      { id: "m2", name: "George Mburu", trade: "Pipe Fitter" },
    ],
  },
  {
    id: "CRW-04", name: "Night Finishing Crew", trade: "Finishes", foreman: "Mary Wanjiku", project: "Riverside Mall", location: "Ground floor retail", shift: "Night", status: "on_leave",
    members: [
      { id: "m1", name: "Paul Maina", trade: "Painter" },
      { id: "m2", name: "Esther Achieng", trade: "Tiler" },
      { id: "m3", name: "Victor Baraka", trade: "Plasterer" },
    ],
  },
];

const STATUS_META: Record<Crew["status"], { label: string; cls: string }> = {
  on_site: { label: "On Site", cls: "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30" },
  off_site: { label: "Off Site", cls: "bg-[#5B6675]/15 text-[#8A95A5] border-[#5B6675]/30" },
  on_leave: { label: "On Leave", cls: "bg-[#F5A623]/15 text-[#F5A623] border-[#F5A623]/30" },
};

export default function Crews({ role }: { role: Role }) {
  const [crews, setCrews] = useState<Crew[]>(SEED);
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([SEED[0]?.id]));
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberTrade, setNewMemberTrade] = useState("");

  // Load persisted crews; keep SEED only if the backend is unreachable
  useEffect(() => {
    (async () => {
      try { setCrews((await api.getCrews()).map(mapCrew)); }
      catch { /* offline — keep SEED */ }
    })();
  }, []);

  const filtered = useMemo(() => crews.filter((c) => {
    if (q && !`${c.name} ${c.trade} ${c.foreman} ${c.project}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [crews, q]);

  const totalWorkers = crews.reduce((s, c) => s + c.members.length, 0);
  const onSiteCount = crews.filter((c) => c.status === "on_site").reduce((s, c) => s + c.members.length, 0);

  const toggle = (id: string) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const setStatus = (id: string, status: Crew["status"]) => {
    setCrews((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    toast.success(`Crew marked ${STATUS_META[status].label}`);
    api.updateCrew(id, { status }).catch(() => { /* offline */ });
  };

  const addMember = (crewId: string) => {
    if (!newMemberName.trim()) { toast.error("Member name is required"); return; }
    const member = { id: `m${Date.now()}`, name: newMemberName.trim(), trade: newMemberTrade.trim() || "General Labourer" };
    const next = [...(crews.find((c) => c.id === crewId)?.members ?? []), member];
    setCrews((prev) => prev.map((c) => (c.id === crewId ? { ...c, members: next } : c)));
    setNewMemberName(""); setNewMemberTrade(""); setAddingTo(null);
    toast.success("Member added to crew");
    api.updateCrew(crewId, { members: next }).catch(() => { /* offline */ });
  };

  const removeMember = (crewId: string, memberId: string) => {
    const next = (crews.find((c) => c.id === crewId)?.members ?? []).filter((m) => m.id !== memberId);
    setCrews((prev) => prev.map((c) => (c.id === crewId ? { ...c, members: next } : c)));
    toast.success("Member removed");
    api.updateCrew(crewId, { members: next }).catch(() => { /* offline */ });
  };

  const removeCrew = (id: string) => {
    setCrews((prev) => prev.filter((c) => c.id !== id));
    toast.success("Crew deleted");
    api.deleteCrew(id).catch(() => { /* offline */ });
  };

  return (
    <div className="px-4 sm:px-7 py-6">
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4">
          <div className="text-[11px] text-[#8A95A5] uppercase tracking-wider">Crews</div>
          <div className="text-[22px] text-white mt-1">{crews.length}</div>
        </div>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4">
          <div className="text-[11px] text-[#8A95A5] uppercase tracking-wider">Total Workers</div>
          <div className="text-[22px] text-white mt-1">{totalWorkers}</div>
        </div>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4">
          <div className="text-[11px] text-[#8A95A5] uppercase tracking-wider">On Site Now</div>
          <div className="text-[22px] text-[#22C55E] mt-1">{onSiteCount}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B6675]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search crews…" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg pl-9 pr-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
        </div>
        <button onClick={() => setShowNew(true)} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New Crew</button>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 && <div className="text-center text-[13px] text-[#5B6675] py-10">No crews match your search.</div>}
        {filtered.map((c) => {
          const isOpen = expanded.has(c.id);
          return (
            <div key={c.id} className="bg-[#11161D] border border-[#222A35] rounded-xl overflow-hidden">
              <button onClick={() => toggle(c.id)} className="w-full text-left p-4 hover:bg-[#161C24]/50 transition">
                <div className="flex items-center gap-2 flex-wrap">
                  {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-[#5B6675]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#5B6675]" />}
                  <span className="text-[13px] text-white">{c.name}</span>
                  <span className="text-[11px] text-[#8A95A5]">· {c.trade}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#222A35] text-[#8A95A5]">{c.members.length} workers</span>
                  <span className="flex-1" />
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#222A35] text-[#8A95A5]">{c.shift} shift</span>
                  <span className={`text-[10px] px-2 py-1 rounded-full border ${STATUS_META[c.status].cls}`}>{STATUS_META[c.status].label}</span>
                </div>
                <div className="flex items-center gap-3 mt-2 ml-5 text-[11px] text-[#8A95A5] flex-wrap">
                  <span className="flex items-center gap-1"><HardHat className="w-3 h-3" /> Foreman: {c.foreman}</span>
                  <span>{c.project}</span>
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {c.location}</span>
                </div>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 border-t border-[#222A35] pt-3">
                  <div className="space-y-1.5">
                    {c.members.map((m) => (
                      <div key={m.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[#161C24]">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#FF6B1A] to-[#F5A623] flex items-center justify-center text-white text-[9px]">{m.name.split(" ").map((p) => p[0]).join("")}</div>
                        <span className="text-[12px] text-white flex-1">{m.name}</span>
                        <span className="text-[11px] text-[#8A95A5]">{m.trade}</span>
                        <button onClick={() => removeMember(c.id, m.id)} className="text-[#5B6675] hover:text-[#EF4444]"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    ))}
                  </div>
                  {addingTo === c.id ? (
                    <div className="flex gap-2 mt-2">
                      <input value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} placeholder="Name" className="flex-1 h-8 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" />
                      <input value={newMemberTrade} onChange={(e) => setNewMemberTrade(e.target.value)} placeholder="Trade" className="w-32 h-8 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" />
                      <button onClick={() => addMember(c.id)} className="h-8 px-3 bg-[#FF6B1A] text-black rounded-lg text-[11px] font-medium">Add</button>
                      <button onClick={() => setAddingTo(null)} className="h-8 px-2 bg-[#222A35] text-white rounded-lg text-[11px]">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setAddingTo(c.id)} className="mt-2 text-[11px] text-[#FF6B1A] flex items-center gap-1 hover:underline"><UserPlus className="w-3 h-3" /> Add member</button>
                  )}
                  <div className="flex flex-wrap gap-2 mt-4">
                    {(["on_site", "off_site", "on_leave"] as const).filter((s) => s !== c.status).map((s) => (
                      <button key={s} onClick={() => setStatus(c.id, s)} className={`h-7 px-2.5 rounded-lg text-[10px] border ${STATUS_META[s].cls}`}>Mark {STATUS_META[s].label}</button>
                    ))}
                    <button onClick={() => removeCrew(c.id)} className="h-7 px-2.5 bg-[#222A35] text-[#EF4444] rounded-lg text-[10px] flex items-center gap-1 ml-auto"><Trash2 className="w-3 h-3" /> Delete crew</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showNew && <NewCrewModal onClose={() => setShowNew(false)} onCreate={async (c) => {
        setCrews((prev) => [c, ...prev]);
        setExpanded((prev) => new Set(prev).add(c.id));
        toast.success(`Crew "${c.name}" created`);
        try {
          const saved = await api.createCrew({ name: c.name, trade: c.trade, foreman: c.foreman, project: c.project, location: c.location, shift: c.shift, status: c.status, members: c.members });
          setCrews((prev) => prev.map((x) => x.id === c.id ? mapCrew(saved) : x));
        } catch { /* offline — keep local */ }
      }} />}
    </div>
  );
}

function NewCrewModal({ onClose, onCreate }: { onClose: () => void; onCreate: (c: Crew) => void }) {
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [foreman, setForeman] = useState("");
  const [project, setProject] = useState("Westside Tower");
  const [location, setLocation] = useState("");
  const [shift, setShift] = useState<Crew["shift"]>("Day");

  const submit = () => {
    if (!name.trim()) { toast.error("Crew name is required"); return; }
    onCreate({
      id: `CRW-${String(Math.floor(Math.random() * 90) + 10)}`,
      name: name.trim(), trade: trade.trim() || "General", foreman: foreman.trim() || "Unassigned",
      project, location: location.trim() || "Unassigned", shift, status: "off_site", members: [],
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-white flex items-center gap-2"><UsersRound className="w-4 h-4 text-[#FF6B1A]" /> New Crew</h3>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Crew name" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
          <div className="grid grid-cols-2 gap-3">
            <input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="Trade" className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
            <input value={foreman} onChange={(e) => setForeman(e.target.value)} placeholder="Foreman" className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select value={project} onChange={(e) => setProject(e.target.value)} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">
              <option>Westside Tower</option><option>Riverside Mall</option><option>Hilltop Residences</option>
            </select>
            <select value={shift} onChange={(e) => setShift(e.target.value as Crew["shift"])} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">
              <option>Day</option><option>Night</option>
            </select>
          </div>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Work location" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="h-9 px-4 bg-[#222A35] rounded-lg text-[12px] text-white">Cancel</button>
          <button onClick={submit} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium">Create Crew</button>
        </div>
      </div>
    </div>
  );
}
