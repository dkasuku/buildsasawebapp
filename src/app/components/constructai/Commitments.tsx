import { useEffect, useState } from "react";
import { Handshake, Calendar, DollarSign, Plus, Trash2 } from "lucide-react";
import api from "../../services/api";

type CommitmentRow = { id?: string; vendor: string; scope: string; amount: string; due: string };

export function Commitments() {
  const [rows, setRows] = useState<CommitmentRow[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [form, setForm] = useState<CommitmentRow>({ vendor: "", scope: "", amount: "", due: "" });

  useEffect(() => {
    api.getProjects().then((ps) => {
      const pid = ps[0]?.id || ps[0]?.code;
      if (!pid) return;
      setProjectId(pid);
      api.getCommitments(pid).then(setRows).catch(() => {});
    });
  }, []);

  const add = async () => {
    if (!projectId) return;
    const payload = { ...form };
    setForm({ vendor: "", scope: "", amount: "", due: "" });
    try {
      const row = await api.createCommitment(projectId, payload);
      setRows((prev) => [row, ...prev]);
    } catch {
      setRows((prev) => [payload, ...prev]);
    }
  };

  const del = async (id?: string) => {
    if (!projectId || !id) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      await api.deleteCommitment(projectId, id);
    } catch {
      // ignore
    }
  };

  return (
    <div className="px-4 sm:px-7 py-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-[13px] text-white font-display">Commitments</div>
          <div className="text-[11px] text-[#8A95A5]">Subcontracts, POs, and obligations</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={form.vendor} onChange={(e) => setForm((s) => ({ ...s, vendor: e.target.value }))} placeholder="Vendor" className="h-9 flex-1 sm:flex-none min-w-[120px] bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white" />
          <input value={form.scope} onChange={(e) => setForm((s) => ({ ...s, scope: e.target.value }))} placeholder="Scope" className="h-9 flex-1 sm:flex-none min-w-[120px] bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white" />
          <input value={form.amount} onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))} placeholder="Amount" className="h-9 w-28 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white" />
          <input value={form.due} onChange={(e) => setForm((s) => ({ ...s, due: e.target.value }))} placeholder="Due" className="h-9 w-24 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white" />
          <button onClick={add} className="h-9 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        <div className="hidden sm:block overflow-x-auto">
        <table className="w-full min-w-[640px] text-[12px]">
          <thead className="bg-[#0A0E14] text-[#5B6675] text-[11px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5">Vendor</th>
              <th className="text-left px-3 py-2.5">Scope</th>
              <th className="text-right px-3 py-2.5">Amount</th>
              <th className="text-right px-4 py-2.5">Due</th>
              <th className="text-right px-3 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#222A35] text-white">
            {rows.map((r, idx) => (
              <tr key={r.id || r.vendor}>
                <td className="px-4 py-3 flex items-center gap-2"><Handshake className="w-4 h-4 text-[#FF6B1A]" />
                  <input value={r.vendor} onChange={(e) => setRows((prev) => prev.map((row, i) => i === idx ? { ...row, vendor: e.target.value } : row))} className="bg-transparent border border-[#222A35] rounded px-2 py-1 text-[12px] text-white w-full" />
                </td>
                <td className="px-3 py-3 text-[#C2CAD6]">
                  <input value={r.scope} onChange={(e) => setRows((prev) => prev.map((row, i) => i === idx ? { ...row, scope: e.target.value } : row))} className="bg-transparent border border-[#222A35] rounded px-2 py-1 text-[12px] text-white w-full" />
                </td>
                <td className="px-3 py-3 text-right">
                  <input value={r.amount} onChange={(e) => setRows((prev) => prev.map((row, i) => i === idx ? { ...row, amount: e.target.value } : row))} className="bg-transparent border border-[#222A35] rounded px-2 py-1 text-[12px] text-white text-right w-full" />
                </td>
                <td className="px-4 py-3 text-right text-[#8A95A5] flex items-center justify-end gap-1">
                  <Calendar className="w-4 h-4 text-[#5B6675]" />
                  <input value={r.due} onChange={(e) => setRows((prev) => prev.map((row, i) => i === idx ? { ...row, due: e.target.value } : row))} className="bg-transparent border border-[#222A35] rounded px-2 py-1 text-[12px] text-white w-24 text-right" />
                </td>
                <td className="px-3 py-3 text-right space-x-2">
                  {r.id && projectId && (
                    <>
                      <button onClick={() => api.updateCommitment(projectId, r.id!, r)} className="text-[11px] text-[#8A95A5] hover:text-white">Save</button>
                      <button onClick={() => del(r.id)} className="text-[11px] text-[#FF6B1A] hover:underline flex items-center gap-1"><Trash2 className="w-3 h-3" /> Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {/* Cards — phones */}
        <div className="sm:hidden divide-y divide-[#222A35]">
          {rows.length === 0 && <div className="text-center py-8 text-[11px] text-[#5B6675]">No commitments yet</div>}
          {rows.map((r, idx) => (
            <div key={r.id || r.vendor} className="p-3 space-y-2">
              <div className="flex items-center gap-2"><Handshake className="w-4 h-4 text-[#FF6B1A] shrink-0" /><input value={r.vendor} onChange={(e) => setRows((prev) => prev.map((row, i) => i === idx ? { ...row, vendor: e.target.value } : row))} placeholder="Vendor" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded px-2 text-[12px] text-white" /></div>
              <input value={r.scope} onChange={(e) => setRows((prev) => prev.map((row, i) => i === idx ? { ...row, scope: e.target.value } : row))} placeholder="Scope" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded px-2 text-[12px] text-white" />
              <div className="flex gap-2">
                <input value={r.amount} onChange={(e) => setRows((prev) => prev.map((row, i) => i === idx ? { ...row, amount: e.target.value } : row))} placeholder="Amount" className="flex-1 h-9 bg-[#0A0E14] border border-[#222A35] rounded px-2 text-[12px] text-white text-right" />
                <input value={r.due} onChange={(e) => setRows((prev) => prev.map((row, i) => i === idx ? { ...row, due: e.target.value } : row))} placeholder="Due" className="w-28 h-9 bg-[#0A0E14] border border-[#222A35] rounded px-2 text-[12px] text-white text-right" />
              </div>
              {r.id && projectId && (
                <div className="flex items-center gap-3 pt-1">
                  <button onClick={() => api.updateCommitment(projectId, r.id!, r)} className="text-[12px] text-[#8A95A5] hover:text-white">Save</button>
                  <button onClick={() => del(r.id)} className="text-[12px] text-[#FF6B1A] hover:underline flex items-center gap-1 ml-auto"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
