import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Search, FileText, X, Trash2, DollarSign, Hammer } from "lucide-react";
import type { Role } from "./roles";
import { ROLES, TRADES } from "./roles";
import api, { type BidDto } from "../../services/api";

const STATUS_COLOR: Record<string, string> = {
  submitted: "#3B82F6",
  "under-review": "#F5A623",
  awarded: "#22C55E",
  rejected: "#EF4444",
};

const STATUSES = ["submitted", "under-review", "awarded", "rejected"];

export default function Bidding({ role = "Contractor" }: { role?: Role }) {
  const perms = ROLES[role];
  const [bids, setBids] = useState<BidDto[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ subcontractor: "", trade: "General" as any, amount: "", status: "submitted" as string, notes: "", submittedAt: "" });

  useEffect(() => {
    api.getProjects().then((ps) => {
      const list = ps.map((p) => ({ id: p.id || p.code, name: p.name }));
      setProjects(list);
      if (list.length) {
        setProjectId(list[0].id);
        api.getBids(list[0].id).then(setBids).catch(() => {});
      }
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    api.getBids(projectId).then(setBids).catch(() => {});
  }, [projectId]);

  const filtered = bids.filter((b) => {
    if (statusFilter !== "All" && b.status !== statusFilter) return false;
    if (q && !(`${b.subcontractor} ${b.trade} ${b.notes}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  const createBid = async () => {
    if (!perms.manageTeam) return toast.error(`${role} cannot create bids`);
    if (!form.subcontractor.trim() || !form.amount) return toast.error("Subcontractor and amount required");
    const payload = { ...form, amount: Number(form.amount), submittedAt: form.submittedAt || new Date().toISOString().split("T")[0] };
    try {
      const row = await api.createBid(projectId, payload);
      setBids([row, ...bids]);
      setShowNew(false);
      setForm({ subcontractor: "", trade: "General", amount: "", status: "submitted", notes: "", submittedAt: "" });
      toast.success("Bid created");
    } catch {
      setBids([{ ...payload, id: `B-${Date.now()}`, projectId } as BidDto, ...bids]);
      setShowNew(false);
      toast.success("Bid created (offline)");
    }
  };

  const deleteBid = async (id: string) => {
    try { await api.deleteBid(projectId, id); } catch { /* ignore */ }
    setBids(bids.filter((b) => b.id !== id));
    toast.success("Bid deleted");
  };

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-white font-display"><FileText className="w-4 h-4 text-[#FF6B1A]" /> Bidding</div>
          <div className="text-[11px] text-[#8A95A5] mt-0.5">Manage subcontractor bids and tendering</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px]">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bids…" className="w-[180px] sm:w-[220px] h-9 bg-[#11161D] border border-[#222A35] rounded-md pl-8 pr-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px]">
            <option value="All">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {perms.manageTeam && (
            <button onClick={() => setShowNew(true)} className="h-9 px-3 rounded-md text-[12px] flex items-center gap-1.5 bg-[#FF6B1A] hover:bg-[#FF7E33] text-white">
              <Plus className="w-3.5 h-3.5" /> Add Bid
            </button>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {STATUSES.map((s) => (
          <div key={s} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">{s}</div>
            <div className="text-[18px] text-white font-display mt-1">{bids.filter((b) => b.status === s).length}</div>
          </div>
        ))}
      </div>

      {/* Table — tablet & desktop */}
      <div className="hidden sm:block rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                <th className="text-left px-4 py-2.5">Subcontractor</th>
                <th className="text-left px-3 py-2.5">Trade</th>
                <th className="text-left px-3 py-2.5">Amount</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-left px-3 py-2.5">Submitted</th>
                <th className="text-right px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id} className="border-t border-[#222A35] hover:bg-[#161C24]">
                  <td className="px-4 py-2.5 text-white">{b.subcontractor}</td>
                  <td className="px-3 py-2.5"><span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: `${STATUS_COLOR[b.status] || "#5B6675"}20`, color: STATUS_COLOR[b.status] || "#5B6675" }}>{b.trade}</span></td>
                  <td className="px-3 py-2.5 text-white flex items-center gap-1"><DollarSign className="w-3 h-3 text-[#5B6675]" />{b.amount.toLocaleString()}</td>
                  <td className="px-3 py-2.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: `${STATUS_COLOR[b.status] || "#5B6675"}20`, color: STATUS_COLOR[b.status] || "#5B6675" }}>{b.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[#8A95A5]">{b.submittedAt}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => deleteBid(b.id)} className="text-[#8A95A5] hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-[11px] text-[#5B6675]">No bids found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cards — phones */}
      <div className="sm:hidden space-y-2">
        {filtered.length === 0 && <div className="text-center py-8 text-[11px] text-[#5B6675] rounded-xl border border-[#222A35] bg-[#11161D]">No bids found</div>}
        {filtered.map((b) => (
          <div key={b.id} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] text-white truncate">{b.subcontractor}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] shrink-0" style={{ background: `${STATUS_COLOR[b.status] || "#5B6675"}20`, color: STATUS_COLOR[b.status] || "#5B6675" }}>{b.status}</span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: `${STATUS_COLOR[b.status] || "#5B6675"}20`, color: STATUS_COLOR[b.status] || "#5B6675" }}>{b.trade}</span>
              <span className="text-[14px] text-white font-display flex items-center gap-1"><DollarSign className="w-3.5 h-3.5 text-[#5B6675]" />{b.amount.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#222A35] text-[11px] text-[#8A95A5]">
              <span>Submitted {b.submittedAt}</span>
              <button onClick={() => deleteBid(b.id)} className="text-[#8A95A5] hover:text-red-400 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
            </div>
          </div>
        ))}
      </div>

      {/* New bid modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-[14px] text-white font-display">Add Bid</div>
              <button onClick={() => setShowNew(false)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3 text-[12px]">
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Subcontractor</div><input value={form.subcontractor} onChange={(e) => setForm({ ...form, subcontractor: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Trade</div>
                  <select value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">
                    {TRADES.map((t) => <option key={t.name}>{t.name}</option>)}
                  </select>
                </div>
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Amount</div><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Status</div>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Submitted</div><input type="date" value={form.submittedAt} onChange={(e) => setForm({ ...form, submittedAt: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              </div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Notes</div><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#222A35]">
              <button onClick={() => setShowNew(false)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={createBid} className="h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" />Add Bid</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
