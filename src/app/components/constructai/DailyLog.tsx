import { useEffect, useState } from "react";
import { ClipboardList, Calendar, User, MapPin, Plus, Trash2 } from "lucide-react";
import api from "../../services/api";

type LogRow = { id?: string; date: string; crew: string; headcount: number; location: string; notes: string };

export function DailyLog() {
  const [entries, setEntries] = useState<LogRow[]>([]);
  const [form, setForm] = useState<LogRow>({ date: "", crew: "", headcount: 0, location: "", notes: "" });
  const [projectId, setProjectId] = useState<string | undefined>(undefined);

  useEffect(() => {
    api.getProjects().then((ps) => {
      const pid = ps[0]?.id || ps[0]?.code;
      if (!pid) return;
      setProjectId(pid);
      api.getDailyLog(pid).then(setEntries).catch(() => {});
    });
  }, []);

  const addLog = async () => {
    const pid = projectId;
    if (!pid) return;
    const payload = { ...form };
    setForm({ date: "", crew: "", headcount: 0, location: "", notes: "" });
    try {
      const row = await api.createDailyLog(pid, payload as any);
      setEntries((prev) => [row, ...prev]);
    } catch {
      setEntries((prev) => [payload, ...prev]);
    }
  };

  const delLog = async (id?: string) => {
    if (!id) return;
    setEntries((prev) => prev.filter((r) => r.id !== id));
    const pid = projectId;
    if (!pid) return;
    try { await api.deleteDailyLog(pid, id); } catch { /* ignore */ }
  };

  return (
    <div className="px-4 sm:px-7 py-5 space-y-4">
      <div>
        <div className="text-[13px] text-white font-display">Daily Log</div>
        <div className="text-[11px] text-[#8A95A5]">Crew headcount, locations & site notes — the daily site record</div>
      </div>

      <div className="flex flex-col xl:flex-row gap-2">
        <input type="date" value={form.date} onChange={(e) => setForm((s) => ({ ...s, date: e.target.value }))} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white" />
        <input value={form.crew} onChange={(e) => setForm((s) => ({ ...s, crew: e.target.value }))} placeholder="Crew" className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white" />
        <input value={form.headcount} onChange={(e) => setForm((s) => ({ ...s, headcount: Number(e.target.value) || 0 }))} type="number" placeholder="Headcount" className="h-9 w-full xl:w-24 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white" />
        <input value={form.location} onChange={(e) => setForm((s) => ({ ...s, location: e.target.value }))} placeholder="Location" className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white" />
        <input value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} placeholder="Notes" className="flex-1 h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white" />
        <button onClick={addLog} className="h-9 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5 whitespace-nowrap">
          <Plus className="w-4 h-4" /> Add Log
        </button>
      </div>

      <div className="grid gap-3">
        {entries.map((e) => (
          <div key={(e.id ?? e.date + e.crew)} className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white">
              <span className="flex items-center gap-1"><Calendar className="w-4 h-4 text-[#FF6B1A]" /> {new Date(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              <span className="text-[#5B6675] hidden sm:inline">|</span>
              <span className="flex items-center gap-1"><User className="w-4 h-4 text-[#5B6675]" /> {e.crew} crew · {e.headcount} people</span>
              <span className="text-[#5B6675] hidden sm:inline">|</span>
              <span className="flex items-center gap-1"><MapPin className="w-4 h-4 text-[#5B6675]" /> {e.location}</span>
              {e.id && (
                <button onClick={() => delLog(e.id)} className="ml-auto text-[11px] text-[#FF6B1A] hover:underline flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              )}
            </div>
            <div className="text-[12px] text-[#C2CAD6] leading-snug">{e.notes}</div>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="text-center py-8 rounded-xl border border-dashed border-[#222A35] bg-[#11161D]">
            <ClipboardList className="w-6 h-6 text-[#5B6675] mx-auto mb-1" />
            <div className="text-[12px] text-[#5B6675]">No daily logs yet.</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DailyLog;
