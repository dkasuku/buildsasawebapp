// Attendance for casual labour: the morning muster on a site (present, half a
// day, absent) for fundis and helpers who have no login, and the weekly wage
// bill those marks add up to, ready to pay and to share on WhatsApp. Built for
// one hand on a phone. Staff with accounts keep their own check-in tab.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Download, Loader2, MessageCircle, Plus, UserPlus, Users } from "lucide-react";
import api, { type LabourStatus, type MusterDto, type ProjectDto, type WageBillDto } from "../../services/api";
import type { Role } from "./roles";
import Attendance from "./Attendance";
import { PageHeader, Tabs } from "./PageShell";
import { saveOrQueue, isOffline } from "../../services/outbox";

const kes = (n: number) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;
const nairobiToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const monday = (d: string) => { const t = new Date(`${d}T00:00:00Z`); return addDays(d, -((t.getUTCDay() + 6) % 7)); };
const nice = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const TRADES = ["Fundi", "Helper", "Mason", "Carpenter", "Steel fixer", "Plumber", "Electrician", "Painter", "Tiler", "Welder", "Other"];
const field = "h-10 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[14px] sm:text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]/60";

export function AttendanceHub({ role }: { role: Role }) {
  const [tab, setTab] = useState<"labour" | "staff">("labour");
  return (
    <div>
      <PageHeader title="Attendance" subtitle="Who worked on site, and what you owe them."
        tabs={<Tabs label="Attendance sections" value={tab} onChange={setTab} items={[{ id: "labour", label: "Casual labour" }, { id: "staff", label: "Staff check-in" }]} />} />
      {tab === "labour" ? <LabourMuster /> : <Attendance role={role} />}
    </div>
  );
}

export function LabourMuster() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectId, setProjectId] = useState(() => { try { return localStorage.getItem("buildsasa-muster-project") || ""; } catch { return ""; } });
  const [date, setDate] = useState(nairobiToday());
  const [m, setM] = useState<MusterDto | null>(null);
  const [marks, setMarks] = useState<Record<string, LabourStatus | null>>({});
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [nw, setNw] = useState({ name: "", trade: "Helper", dailyRate: "", phone: "" });
  const [bill, setBill] = useState<WageBillDto | null>(null);

  useEffect(() => { api.getProjects().then((ps) => { setProjects(ps); if (!projectId && ps[0]) setProjectId(ps[0].id); }).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { if (projectId) localStorage.setItem("buildsasa-muster-project", projectId); } catch { /* */ } }, [projectId]);
  const load = () => {
    if (!projectId) return;
    const key = `buildsasa-muster:${projectId}`;
    api.muster(projectId, date).then((r) => {
      setM(r); setMarks(Object.fromEntries(r.workers.map((w) => [w.id, w.status])));
      try { localStorage.setItem(key, JSON.stringify(r)); } catch { /* */ }
    }).catch((e) => {
      // No signal: open with this site's workers from the last time, so the day can still be marked.
      let cached: MusterDto | null = null;
      try { cached = JSON.parse(localStorage.getItem(key) || "null"); } catch { /* */ }
      if (cached && isOffline(e)) {
        const r = { ...cached, date, workers: cached.workers.map((w) => ({ ...w, status: cached!.date === date ? w.status : null, pay: 0 })) };
        setM(r); setMarks(Object.fromEntries(r.workers.map((w) => [w.id, w.status])));
        toast("No signal: showing this site's workers from your last visit. Marks save on the phone.", { duration: 5000 });
      } else toast.error(e?.message || "Couldn't load the muster");
    });
    const mon = monday(date);
    api.wageBill({ projectId, from: mon, to: addDays(mon, 6) }).then(setBill).catch(() => {});
  };
  useEffect(load, [projectId, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = useMemo(() => (m ? m.workers.filter((w) => (marks[w.id] ?? null) !== w.status) : []), [m, marks]);
  const counts = useMemo(() => {
    const ws = m?.workers || [];
    const pay = ws.reduce((s, w) => s + (marks[w.id] === "present" ? w.dailyRate : marks[w.id] === "half" ? w.dailyRate / 2 : 0), 0);
    return { present: ws.filter((w) => marks[w.id] === "present").length, half: ws.filter((w) => marks[w.id] === "half").length, unmarked: ws.filter((w) => !marks[w.id]).length, pay };
  }, [m, marks]);
  const set = (id: string, s: LabourStatus) => setMarks((x) => ({ ...x, [id]: x[id] === s ? null : s }));
  const allPresent = () => setMarks((x) => Object.fromEntries((m?.workers || []).map((w) => [w.id, w.elsewhere ? x[w.id] ?? null : x[w.id] || "present"])));
  const save = async () => {
    if (!m) return;
    setSaving(true);
    try {
      const r: any = await saveOrQueue({ label: `Muster · ${projects.find((p) => p.id === m.projectId)?.name || ""} · ${nice(m.date)}`, method: "POST", path: "/api/labour/muster", body: { projectId: m.projectId, date: m.date, marks: changed.map((w) => ({ labourerId: w.id, status: marks[w.id] ?? null })) } });
      if (r && r.queued) { toast.success("No signal: muster saved on this phone. It sends by itself when you're back online.", { duration: 6000 }); setM({ ...m, workers: m.workers.map((w) => ({ ...w, status: marks[w.id] ?? null })) }); }
      else { toast.success(`Muster saved: ${counts.present + counts.half * 0.5} labour-day${counts.present + counts.half * 0.5 === 1 ? "" : "s"}, ${kes(counts.pay)}`); load(); }
    }
    catch (e: any) { toast.error(e?.message || "Couldn't save"); }
    setSaving(false);
  };
  const addWorker = async () => {
    if (!nw.name.trim()) return toast.error("Name the worker");
    try { await api.addLabourers([{ name: nw.name.trim(), trade: nw.trade, dailyRate: Number(nw.dailyRate) || 0, phone: nw.phone || undefined, projectId }]); setNw({ name: "", trade: nw.trade, dailyRate: nw.dailyRate, phone: "" }); load(); toast.success("Added to the muster"); }
    catch (e: any) { toast.error(e?.message || "Couldn't add"); }
  };
  const editRate = async (id: string, v: string) => { try { await api.updateLabourer(id, { dailyRate: Number(v) || 0 }); load(); } catch (e: any) { toast.error(e?.message || "Couldn't save"); } };

  const project = projects.find((p) => p.id === projectId);
  const billText = bill ? [`Wage bill: ${project?.name || ""}`, `${nice(bill.from)} to ${nice(bill.to)}`, ...bill.rows.map((r) => `${r.name}${r.trade ? ` (${r.trade})` : ""}: ${r.days}${r.halfDays ? ` + ${r.halfDays} half` : ""} day${r.days === 1 && !r.halfDays ? "" : "s"} x ${kes(r.dailyRate)} = ${kes(r.amount)}`), `Total: ${kes(bill.total)} for ${bill.labourDays} labour-days`].join("\n") : "";
  const csv = () => {
    if (!bill) return;
    const rows = [["Name", "Trade", "Phone", "Full days", "Half days", "Daily rate (KES)", "Amount (KES)"], ...bill.rows.map((r) => [r.name, r.trade || "", r.phone || "", r.days, r.halfDays, r.dailyRate, Math.round(r.amount)]), ["Total", "", "", "", "", "", Math.round(bill.total)]];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n")], { type: "text/csv" }));
    a.download = `Wage bill ${project?.name || ""} ${bill.from}.csv`; a.click();
  };

  return (
    <div className="px-4 sm:px-8 py-5 space-y-4 max-w-3xl">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${field} flex-1 min-w-[180px]`}>
          {!projects.length && <option value="">Loading projects…</option>}
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" aria-label="Day" value={date} max={nairobiToday()} onChange={(e) => e.target.value && setDate(e.target.value)} className={field} />
      </div>

      <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[#222A35]">
          <Users className="w-4 h-4 text-[#FF8A47]" />
          <div className="text-[14px] text-white">Muster · {nice(date)}</div>
          <div className="text-[12px] text-[#8A95A5]">{counts.present} present{counts.half ? `, ${counts.half} half day` : ""}{counts.unmarked ? `, ${counts.unmarked} not marked` : ""} · {kes(counts.pay)}</div>
          {!!m?.workers.length && <button onClick={allPresent} className="ml-auto h-8 px-3 rounded-lg border border-[#222A35] text-[12px] text-[#C2CAD6] hover:text-white">Everyone present</button>}
        </div>
        {!m ? <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#5B6675]" /></div>
          : !m.workers.length ? <div className="p-6 text-center text-[13px] text-[#8A95A5]">No workers on this site yet. Add your fundis and helpers below once; after that, marking the day takes a few taps. Or tell Buildsasa AI: "Add Juma, mason, 1,200 a day".</div>
          : (
            <div className="divide-y divide-[#222A35]">
              {m.workers.map((w) => (
                <div key={w.id} className="px-4 py-2.5 flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="text-[14px] text-white truncate">{w.name}</div>
                    <div className="text-[11.5px] text-[#8A95A5] flex items-center gap-1.5">{w.trade || "Worker"} ·
                      <input aria-label={`${w.name} daily rate`} defaultValue={w.dailyRate || ""} placeholder="rate" inputMode="numeric" onBlur={(e) => Number(e.target.value) !== w.dailyRate && editRate(w.id, e.target.value)} className="w-16 bg-transparent border-b border-dashed border-[#2C3744] text-[11.5px] text-[#C2CAD6] focus:outline-none" /> /day
                      {w.elsewhere && <span className="text-[#FBBF24]">· marked on another site today</span>}
                    </div>
                  </div>
                  <div className="flex gap-1" role="radiogroup" aria-label={`${w.name} today`}>
                    {([["present", "Present", "bg-[#22C55E] border-[#22C55E]"], ["half", "½ day", "bg-[#F59E0B] border-[#F59E0B]"], ["absent", "Absent", "bg-[#5B6675] border-[#5B6675]"]] as const).map(([k, l, on]) => (
                      <button key={k} role="radio" aria-checked={marks[w.id] === k} onClick={() => set(w.id, k)}
                        className={`h-10 sm:h-9 px-3 rounded-lg text-[12.5px] border ${marks[w.id] === k ? `${on} text-[#ffffff]` : "border-[#222A35] text-[#C2CAD6]"}`}>{l}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        <div className="px-4 py-3 border-t border-[#222A35] flex flex-wrap items-center gap-2">
          <button onClick={() => setAdding((a) => !a)} className="h-9 px-3 rounded-lg border border-[#222A35] text-[12.5px] text-[#C2CAD6] hover:text-white inline-flex items-center gap-1.5"><UserPlus className="w-4 h-4" /> Add worker</button>
          <button onClick={save} disabled={!changed.length || saving} className="ml-auto h-10 px-5 rounded-lg bg-[#FF6B1A] text-[#ffffff] text-[13.5px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save muster{changed.length ? ` (${changed.length})` : ""}</button>
        </div>
        {adding && (
          <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-[1.4fr_1fr_0.8fr_1fr_auto] gap-2">
            <input aria-label="Worker name" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addWorker()} placeholder="Name" className={`${field} col-span-2 sm:col-span-1`} />
            <select aria-label="Trade" value={nw.trade} onChange={(e) => setNw({ ...nw, trade: e.target.value })} className={field}>{TRADES.map((t) => <option key={t}>{t}</option>)}</select>
            <input aria-label="Daily rate" value={nw.dailyRate} onChange={(e) => setNw({ ...nw, dailyRate: e.target.value })} inputMode="numeric" placeholder="KES/day" className={field} />
            <input aria-label="Phone" value={nw.phone} onChange={(e) => setNw({ ...nw, phone: e.target.value })} placeholder="Phone (M-Pesa)" className={`${field} col-span-2 sm:col-span-1`} />
            <button onClick={addWorker} className="h-10 px-3 rounded-lg bg-[#161C24] border border-[#2C3744] text-white text-[12.5px] inline-flex items-center justify-center gap-1 col-span-2 sm:col-span-1"><Plus className="w-4 h-4" /> Add</button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[#222A35]">
          <div className="text-[14px] text-white">Wage bill</div>
          <div className="text-[12px] text-[#8A95A5]">{bill ? `${nice(bill.from)} to ${nice(bill.to)}` : ""}</div>
          <div className="ml-auto flex gap-1.5">
            <button onClick={() => setDate(addDays(monday(date), -7))} className="h-8 px-2.5 rounded-md border border-[#222A35] text-[12px] text-[#C2CAD6]">Last week</button>
            {monday(date) !== monday(nairobiToday()) && <button onClick={() => setDate(nairobiToday())} className="h-8 px-2.5 rounded-md border border-[#222A35] text-[12px] text-[#C2CAD6]">This week</button>}
          </div>
        </div>
        {!bill?.rows.length ? <div className="p-5 text-[13px] text-[#8A95A5]">Nothing worked this week yet. The bill fills in as you save each day's muster.</div> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-[11px] uppercase tracking-wider text-[#5B6675]"><tr><th className="text-left px-4 py-2">Worker</th><th className="text-right px-2">Days</th><th className="text-right px-2 hidden sm:table-cell">Rate</th><th className="text-right px-4">Pay</th></tr></thead>
                <tbody className="divide-y divide-[#222A35]">
                  {bill.rows.map((r) => (
                    <tr key={r.id}><td className="px-4 py-2 text-white">{r.name}<div className="text-[11px] text-[#8A95A5]">{r.trade}{r.phone ? ` · ${r.phone}` : ""}</div></td>
                      <td className="text-right px-2 text-[#C2CAD6] tabular-nums">{r.days}{r.halfDays ? ` + ${r.halfDays}½` : ""}</td>
                      <td className="text-right px-2 text-[#8A95A5] tabular-nums hidden sm:table-cell">{Math.round(r.dailyRate).toLocaleString("en-KE")}</td>
                      <td className="text-right px-4 text-white tabular-nums">{Math.round(r.amount).toLocaleString("en-KE")}</td></tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t border-[#222A35]"><td className="px-4 py-2.5 text-white font-medium">Total</td><td className="text-right px-2 text-[#C2CAD6] tabular-nums">{bill.labourDays}</td><td className="hidden sm:table-cell" /><td className="text-right px-4 text-[#FF8A47] font-medium tabular-nums">{kes(bill.total)}</td></tr></tfoot>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-[#222A35] flex flex-wrap gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent(billText)}`} target="_blank" rel="noreferrer" className="h-9 px-3 rounded-lg bg-[#25D366] text-[#ffffff] text-[12.5px] inline-flex items-center gap-1.5"><MessageCircle className="w-4 h-4" /> Share on WhatsApp</a>
              <button onClick={() => navigator.clipboard?.writeText(billText).then(() => toast.success("Copied"))} className="h-9 px-3 rounded-lg border border-[#222A35] text-[12.5px] text-[#C2CAD6] inline-flex items-center gap-1.5"><Copy className="w-4 h-4" /> Copy</button>
              <button onClick={csv} className="h-9 px-3 rounded-lg border border-[#222A35] text-[12.5px] text-[#C2CAD6] inline-flex items-center gap-1.5"><Download className="w-4 h-4" /> Excel (CSV)</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
