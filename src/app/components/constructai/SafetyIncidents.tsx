import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Search, X, Trash2, AlertTriangle } from "lucide-react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import api, { type SafetyIncidentDto } from "../../services/api";

const SEVERITY_COLOR: Record<string, string> = {
  minor: "#F5A623",
  moderate: "#FF6B1A",
  major: "#EF4444",
  fatality: "#7F1D1D",
};

const STATUS_COLOR: Record<string, string> = {
  open: "#EF4444",
  investigating: "#F5A623",
  closed: "#22C55E",
};

const SEVERITIES = ["minor", "moderate", "major", "fatality"];
const STATUSES = ["open", "investigating", "closed"];
const TYPES = ["injury", "near-miss", "environmental", "property", "struck-by-equipment", "rollover", "cave-in", "traffic-incident", "asphalt-burn"];

const TYPE_LABELS: Record<string, string> = {
  injury: "Injury",
  "near-miss": "Near Miss",
  environmental: "Environmental",
  property: "Property Damage",
  "struck-by-equipment": "Struck by Equipment",
  rollover: "Equipment Rollover",
  "cave-in": "Cave-in / Trench Collapse",
  "traffic-incident": "Traffic Incident",
  "asphalt-burn": "Asphalt Burn / Hot Material",
};

export default function SafetyIncidents({ role = "Contractor" }: { role?: Role }) {
  const perms = ROLES[role];
  const [incidents, setIncidents] = useState<SafetyIncidentDto[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ date: "", incidentType: "injury" as string, severity: "minor" as string, description: "", reporter: "", witnesses: "", correctiveAction: "", status: "open" as string });

  useEffect(() => {
    api.getProjects().then((ps) => {
      const list = ps.map((p) => ({ id: p.id || p.code, name: p.name }));
      setProjects(list);
      if (list.length) {
        setProjectId(list[0].id);
        api.getSafetyIncidents(list[0].id).then(setIncidents).catch(() => {});
      }
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    api.getSafetyIncidents(projectId).then(setIncidents).catch(() => {});
  }, [projectId]);

  const filtered = incidents.filter((i) => {
    if (statusFilter !== "All" && i.status !== statusFilter) return false;
    if (q && !(`${i.description} ${i.reporter} ${i.incidentType}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  const createIncident = async () => {
    if (!perms.assignTasks) return toast.error(`${role} cannot create incidents`);
    if (!form.description.trim() || !form.reporter.trim() || !form.date) return toast.error("Description, reporter, and date required");
    try {
      const row = await api.createSafetyIncident(projectId, form);
      setIncidents([row, ...incidents]);
      setShowNew(false);
      setForm({ date: "", incidentType: "injury", severity: "minor", description: "", reporter: "", witnesses: "", correctiveAction: "", status: "open" });
      toast.success("Incident reported");
    } catch {
      setIncidents([{ ...form, id: `SI-${Date.now()}`, projectId } as SafetyIncidentDto, ...incidents]);
      setShowNew(false);
      toast.success("Incident reported (offline)");
    }
  };

  const deleteIncident = async (id: string) => {
    try { await api.deleteSafetyIncident(projectId, id); } catch { /* ignore */ }
    setIncidents(incidents.filter((i) => i.id !== id));
    toast.success("Incident deleted");
  };

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-white font-display"><AlertTriangle className="w-4 h-4 text-[#FF6B1A]" /> Safety Incidents</div>
          <div className="text-[11px] text-[#8A95A5] mt-0.5">Report and track safety incidents, near-misses, and corrective actions</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px]">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search incidents…" className="w-[180px] sm:w-[220px] h-9 bg-[#11161D] border border-[#222A35] rounded-md pl-8 pr-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px]">
            <option value="All">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {perms.assignTasks && (
            <button onClick={() => setShowNew(true)} className="h-9 px-3 rounded-md text-[12px] flex items-center gap-1.5 bg-[#FF6B1A] hover:bg-[#FF7E33] text-white">
              <Plus className="w-3.5 h-3.5" /> Report
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {SEVERITIES.map((s) => (
          <div key={s} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">{s}</div>
            <div className="text-[18px] text-white font-display mt-1">{incidents.filter((i) => i.severity === s).length}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full min-w-[800px] text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-3 py-2.5">Type</th>
                <th className="text-left px-3 py-2.5">Severity</th>
                <th className="text-left px-3 py-2.5">Description</th>
                <th className="text-left px-3 py-2.5">Reporter</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} className="border-t border-[#222A35] hover:bg-[#161C24]">
                  <td className="px-4 py-2.5 text-[#8A95A5]">{i.date}</td>
                  <td className="px-3 py-2.5"><span className="px-1.5 py-0.5 rounded text-[10px] bg-[#222A35] text-[#8A95A5]">{TYPE_LABELS[i.incidentType] || i.incidentType}</span></td>
                  <td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: (SEVERITY_COLOR[i.severity] || "#5B6675") + "20", color: SEVERITY_COLOR[i.severity] || "#5B6675" }}>{i.severity}</span></td>
                  <td className="px-3 py-2.5 text-white max-w-[220px] truncate">{i.description}</td>
                  <td className="px-3 py-2.5 text-[#8A95A5]">{i.reporter}</td>
                  <td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: (STATUS_COLOR[i.status] || "#5B6675") + "20", color: STATUS_COLOR[i.status] || "#5B6675" }}>{i.status}</span></td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => deleteIncident(i.id)} className="text-[#8A95A5] hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-[11px] text-[#5B6675]">No incidents found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Cards — phones */}
        <div className="sm:hidden divide-y divide-[#222A35]">
          {filtered.length === 0 && <div className="text-center py-8 text-[11px] text-[#5B6675]">No incidents found</div>}
          {filtered.map((i) => (
            <div key={i.id} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] shrink-0" style={{ background: (SEVERITY_COLOR[i.severity] || "#5B6675") + "20", color: SEVERITY_COLOR[i.severity] || "#5B6675" }}>{i.severity}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] shrink-0" style={{ background: (STATUS_COLOR[i.status] || "#5B6675") + "20", color: STATUS_COLOR[i.status] || "#5B6675" }}>{i.status}</span>
              </div>
              <div className="text-[13px] text-white mt-1.5">{i.description}</div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-[#8A95A5]">
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#222A35] text-[#8A95A5]">{TYPE_LABELS[i.incidentType] || i.incidentType}</span>
                <span>{i.date}</span>
                <span>{i.reporter}</span>
                <button onClick={() => deleteIncident(i.id)} className="text-[#8A95A5] hover:text-red-400 ml-auto flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-[14px] text-white font-display">Report Safety Incident</div>
              <button onClick={() => setShowNew(false)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3 text-[12px]">
              <div className="grid grid-cols-3 gap-3">
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Date</div><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Type</div>
                  <select value={form.incidentType} onChange={(e) => setForm({ ...form, incidentType: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">
                    {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Severity</div>
                  <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">
                    {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Reporter</div><input value={form.reporter} onChange={(e) => setForm({ ...form, reporter: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Status</div>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Description</div><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Witnesses</div><input value={form.witnesses} onChange={(e) => setForm({ ...form, witnesses: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Corrective Action</div><textarea value={form.correctiveAction} onChange={(e) => setForm({ ...form, correctiveAction: e.target.value })} rows={2} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#222A35]">
              <button onClick={() => setShowNew(false)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={createIncident} className="h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" />Report</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
