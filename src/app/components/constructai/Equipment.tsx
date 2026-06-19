import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Search, X, Trash2, Truck } from "lucide-react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import api, { type EquipmentDto } from "../../services/api";

const STATUS_COLOR: Record<string, string> = {
  available: "#22C55E",
  "in-use": "#3B82F6",
  maintenance: "#F5A623",
  retired: "#EF4444",
};

const STATUSES = ["available", "in-use", "maintenance", "retired"];
const CATEGORIES = ["excavator", "crane", "truck", "mixer", "compactor", "generator", "scaffolding", "tool", "tractor", "grader", "paver", "roller", "drainage-machine", "trencher", "dump-truck"];

const CATEGORY_LABELS: Record<string, string> = {
  excavator: "Excavator",
  crane: "Crane",
  truck: "Truck",
  mixer: "Concrete Mixer",
  compactor: "Compactor",
  generator: "Generator",
  scaffolding: "Scaffolding",
  tool: "Tool / Small Equipment",
  tractor: "Tractor",
  grader: "Motor Grader",
  paver: "Asphalt Paver",
  roller: "Roller / Compactor",
  "drainage-machine": "Drainage Machine",
  trencher: "Trencher",
  "dump-truck": "Dump Truck",
};

export default function Equipment({ role = "Contractor" }: { role?: Role }) {
  const perms = ROLES[role];
  const [equipment, setEquipment] = useState<EquipmentDto[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", category: "excavator" as string, serialNumber: "", manufacturer: "", purchaseDate: "", status: "available" as string, lastService: "", nextService: "", location: "", notes: "", projectId: "" as any });

  useEffect(() => {
    api.getEquipment().then(setEquipment).catch(() => {});
  }, []);

  const filtered = equipment.filter((e) => {
    if (statusFilter !== "All" && e.status !== statusFilter) return false;
    if (q && !(`${e.name} ${e.category} ${e.serialNumber} ${e.location}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  const createEquipment = async () => {
    if (!perms.manageTeam) return toast.error(`${role} cannot add equipment`);
    if (!form.name.trim()) return toast.error("Equipment name required");
    try {
      const row = await api.createEquipment(form);
      setEquipment([row, ...equipment]);
      setShowNew(false);
      setForm({ name: "", category: "excavator", serialNumber: "", manufacturer: "", purchaseDate: "", status: "available", lastService: "", nextService: "", location: "", notes: "", projectId: "" });
      toast.success("Equipment added");
    } catch {
      setEquipment([{ ...form, id: `EQ-${Date.now()}` } as EquipmentDto, ...equipment]);
      setShowNew(false);
      toast.success("Equipment added (offline)");
    }
  };

  const deleteEquipmentItem = async (id: string) => {
    try { await api.deleteEquipment(id); } catch { /* ignore */ }
    setEquipment(equipment.filter((e) => e.id !== id));
    toast.success("Equipment deleted");
  };

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-white font-display"><Truck className="w-4 h-4 text-[#FF6B1A]" /> Equipment Inventory</div>
          <div className="text-[11px] text-[#8A95A5] mt-0.5">Track machinery, tools, and maintenance schedules</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search equipment…" className="w-[180px] sm:w-[220px] h-9 bg-[#11161D] border border-[#222A35] rounded-md pl-8 pr-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px]">
            <option value="All">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {perms.manageTeam && (
            <button onClick={() => setShowNew(true)} className="h-9 px-3 rounded-md text-[12px] flex items-center gap-1.5 bg-[#FF6B1A] hover:bg-[#FF7E33] text-white">
              <Plus className="w-3.5 h-3.5" /> Add Equipment
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {STATUSES.map((s) => (
          <div key={s} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">{s}</div>
            <div className="text-[18px] text-white font-display mt-1">{equipment.filter((e) => e.status === s).length}</div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-3 py-2.5">Category</th>
                <th className="text-left px-3 py-2.5">Serial #</th>
                <th className="text-left px-3 py-2.5">Manufacturer</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-left px-3 py-2.5">Last Service</th>
                <th className="text-left px-3 py-2.5">Next Service</th>
                <th className="text-right px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-t border-[#222A35] hover:bg-[#161C24]">
                  <td className="px-4 py-2.5 text-white font-medium">{e.name}</td>
                  <td className="px-3 py-2.5"><span className="px-1.5 py-0.5 rounded text-[10px] bg-[#222A35] text-[#8A95A5]">{CATEGORY_LABELS[e.category] || e.category}</span></td>
                  <td className="px-3 py-2.5 text-[#8A95A5] font-mono text-[11px]">{e.serialNumber || "—"}</td>
                  <td className="px-3 py-2.5 text-[#8A95A5]">{e.manufacturer || "—"}</td>
                  <td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: (STATUS_COLOR[e.status] || "#5B6675") + "20", color: STATUS_COLOR[e.status] || "#5B6675" }}>{e.status}</span></td>
                  <td className="px-3 py-2.5 text-[#8A95A5]">{e.lastService || "—"}</td>
                  <td className="px-3 py-2.5 text-[#8A95A5]">{e.nextService || "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => deleteEquipmentItem(e.id)} className="text-[#8A95A5] hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-[11px] text-[#5B6675]">No equipment found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cards — phones */}
      <div className="sm:hidden space-y-2">
        {filtered.length === 0 && <div className="text-center py-8 text-[11px] text-[#5B6675] rounded-xl border border-[#222A35] bg-[#11161D]">No equipment found</div>}
        {filtered.map((e) => (
          <div key={e.id} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] text-white font-medium truncate">{e.name}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] shrink-0" style={{ background: (STATUS_COLOR[e.status] || "#5B6675") + "20", color: STATUS_COLOR[e.status] || "#5B6675" }}>{e.status}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#222A35] text-[#8A95A5]">{CATEGORY_LABELS[e.category] || e.category}</span>
              {e.serialNumber && <span className="text-[11px] text-[#8A95A5] font-mono">SN: {e.serialNumber}</span>}
              {e.manufacturer && <span className="text-[11px] text-[#8A95A5]">{e.manufacturer}</span>}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-[#8A95A5]">
              <span>Last service: {e.lastService || "—"}</span>
              <span>Next: {e.nextService || "—"}</span>
            </div>
            <div className="flex justify-end mt-2 pt-2 border-t border-[#222A35]">
              <button onClick={() => deleteEquipmentItem(e.id)} className="text-[11px] text-[#8A95A5] hover:text-red-400 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
            </div>
          </div>
        ))}
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-[14px] text-white font-display">Add Equipment</div>
              <button onClick={() => setShowNew(false)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3 text-[12px]">
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Name</div><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Category</div>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Status</div>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Serial Number</div><input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Manufacturer</div><input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Purchase Date</div><input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Last Service</div><input type="date" value={form.lastService} onChange={(e) => setForm({ ...form, lastService: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Next Service</div><input type="date" value={form.nextService} onChange={(e) => setForm({ ...form, nextService: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              </div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Location</div><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Notes</div><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#222A35]">
              <button onClick={() => setShowNew(false)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={createEquipment} className="h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" />Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
