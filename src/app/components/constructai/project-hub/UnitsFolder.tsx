// The project's "Units" tab: apartment blocks, estates and any job with many
// houses or flats sold to different buyers. Add a whole block in one go, give
// each unit its buyer, tick its fit-out stages, post photos for that unit only,
// and send each buyer their own progress report (email, or WhatsApp in a tap).
// Each buyer sees only their unit plus news about the whole project.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, Check, Copy, FileText, Link2, Loader2, Mail, MessageCircle, Plus, Search, Send, Trash2, UserPlus, Wrench } from "lucide-react";
import { unitReportPdf } from "./unitPdf";
import api, { type UnitDto } from "../../../services/api";
import { MediaPicker } from "../client/ClientParts";
import type { Media } from "../client/clientData";
import { Bar, Empty, Field, Modal, Panel, btnGhost, btnPrimary, input, textarea } from "./shared";

const STATUS: { k: string; label: string; tone: string }[] = [
  { k: "not_started", label: "Not started", tone: "text-[#8A95A5] border-[#222A35]" },
  { k: "in_progress", label: "In progress", tone: "text-[#60A5FA] border-[#3B82F6]/40" },
  { k: "snagging", label: "Snagging", tone: "text-[#FBBF24] border-[#F59E0B]/40" },
  { k: "ready", label: "Ready", tone: "text-[#4ADE80] border-[#22C55E]/40" },
  { k: "handed_over", label: "Handed over", tone: "text-[#4ADE80] border-[#22C55E]/40" },
];
const statusOf = (k: string) => STATUS.find((s) => s.k === k) || STATUS[0];
const wa = (phone: string | null | undefined, text: string) => `https://wa.me/${String(phone || "").replace(/\D/g, "").replace(/^0/, "254")}?text=${encodeURIComponent(text)}`;

export function UnitsFolder({ projectId, projectName, canShare }: { projectId: string; projectName: string; canShare: boolean }) {
  const [units, setUnits] = useState<UnitDto[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<UnitDto | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [block, setBlock] = useState("");
  const [sending, setSending] = useState(false);
  const load = () => api.getUnits(projectId).then((list) => { setUnits(list); setOpen((o) => (o ? list.find((x) => x.id === o.id) || o : o)); }).catch((e) => { setUnits([]); toast.error(e?.message || "Couldn't load units"); });
  const [auto, setAuto] = useState<"weekly" | "monthly" | null>(null);
  useEffect(() => { api.getUnitSettings(projectId).then((r) => setAuto(r.frequency)).catch(() => {}); }, [projectId]);
  const changeAuto = async (v: string) => {
    const f = (v || null) as "weekly" | "monthly" | null;
    try { const r = await api.setUnitSettings(projectId, f); setAuto(r.frequency); toast.success(f ? `Every buyer with an email now gets their unit's report ${f === "weekly" ? "every week" : "every month"}.` : "Automatic reports switched off."); }
    catch (e: any) { toast.error(e?.message || "Couldn't save."); }
  };
  useEffect(() => { load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocks = useMemo(() => [...new Set((units || []).map((u) => u.block || "").filter(Boolean))], [units]);
  const shown = (units || []).filter((u) => (!status || u.status === status) && (!block || u.block === block)
    && (!q.trim() || `${u.code} ${u.clientName || ""} ${u.type || ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const avg = units?.length ? Math.round(units.reduce((s, u) => s + u.progress, 0) / units.length) : 0;
  const withBuyer = (units || []).filter((u) => u.clientName || u.clientEmail || u.clientPhone).length;
  const replace = (u: UnitDto) => { setUnits((x) => (x || []).map((y) => (y.id === u.id ? { ...y, ...u } : y))); setOpen((o) => (o && o.id === u.id ? { ...o, ...u } : o)); };

  const reportAll = async () => {
    if (!window.confirm("Email every buyer their own unit's progress report now? Each buyer only sees their unit.")) return;
    setSending(true);
    try { const r = await api.unitReportAll(projectId); toast.success(`Reports sent to ${r.sent} buyer${r.sent === 1 ? "" : "s"}${r.skipped ? `. ${r.skipped} unit${r.skipped === 1 ? " has" : "s have"} no buyer email yet.` : "."}`); load(); }
    catch (e: any) { toast.error(e?.message || "Couldn't send the reports."); }
    setSending(false);
  };

  if (!units) return <div className="py-10 flex justify-center text-[#5B6675]"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {!units.length ? (
        <Panel title="Units">
          <Empty icon={Building2} title="Apartments or an estate? Track every unit and its buyer"
            hint="Add a whole block in one go (floors × units per floor) or a row of houses. Each unit gets its own stages, photos, invoices and a private link, so every buyer follows their own unit and gets their own progress reports, without seeing anyone else's.">
            <button className={btnPrimary} onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Add units</button>
          </Empty>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[["Units", units.length], ["Average progress", `${avg}%`], ["Ready or handed over", units.filter((u) => u.status === "ready" || u.status === "handed_over").length], ["With a buyer", `${withBuyer}/${units.length}`]].map(([l, v]) => (
              <div key={String(l)} className="rounded-xl border border-[#222A35] bg-[#11161D] px-3.5 py-3">
                <div className="text-[10.5px] uppercase tracking-wider text-[#5B6675]">{l}</div>
                <div className="text-[20px] text-white font-display mt-0.5">{v}</div>
              </div>
            ))}
          </div>
          <Panel title="Units" subtitle="Tap a unit to tick its stages, add the buyer, post photos for that unit and send its report."
            action={<div className="flex flex-wrap gap-2">
              {canShare && (
                <select aria-label="Automatic reports" value={auto || ""} onChange={(e) => changeAuto(e.target.value)} className={`${input} w-auto`} title="Email every buyer their own unit's report automatically">
                  <option value="">Automatic reports: off</option>
                  <option value="weekly">Automatic reports: weekly</option>
                  <option value="monthly">Automatic reports: monthly</option>
                </select>
              )}
              {canShare && <button className={btnGhost} onClick={reportAll} disabled={sending}>{sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send reports to all buyers</button>}
              <button className={btnPrimary} onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Add units</button>
            </div>}>
            <div className="flex flex-wrap gap-2 mb-3">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5B6675]" />
                <input className={`${input} pl-8`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a unit or buyer" aria-label="Find a unit or buyer" />
              </div>
              {blocks.length > 1 && <select className={`${input} w-auto`} value={block} onChange={(e) => setBlock(e.target.value)} aria-label="Block"><option value="">All blocks</option>{blocks.map((b) => <option key={b} value={b}>Block {b}</option>)}</select>}
              <select className={`${input} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option>{STATUS.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {shown.map((u) => (
                <button key={u.id} onClick={() => setOpen(u)} className="text-left rounded-lg border border-[#222A35] bg-[#0A0E14] hover:border-[#FF6B1A]/50 px-3 py-2.5 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] text-white font-medium">{u.code}</span>
                    {u.type && <span className="text-[11px] text-[#8A95A5] truncate">{u.type}</span>}
                    <span className={`ml-auto text-[10.5px] px-1.5 py-0.5 rounded border ${statusOf(u.status).tone}`}>{statusOf(u.status).label}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2"><Bar pct={u.progress} tone={u.progress >= 100 ? "good" : "brand"} className="h-1.5 flex-1" /><span className="text-[11.5px] text-[#C2CAD6] tabular-nums w-9 text-right">{u.progress}%</span></div>
                  {!!u.openSnags && <div className="text-[11px] text-[#FBBF24] mt-1.5 inline-flex items-center gap-1"><Wrench className="w-3 h-3" /> {u.openSnags} open snag{u.openSnags === 1 ? "" : "s"}</div>}
                  <div className="text-[11.5px] text-[#8A95A5] mt-1.5 truncate">{u.clientName ? `Buyer: ${u.clientName}` : "No buyer yet"}{u.link ? " · link shared" : ""}{u.updates ? ` · ${u.updates} update${u.updates === 1 ? "" : "s"}` : ""}</div>
                </button>
              ))}
              {!shown.length && <div className="text-[12.5px] text-[#8A95A5] py-4">No unit matches.</div>}
            </div>
          </Panel>
        </>
      )}
      {adding && <AddUnits projectId={projectId} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); load(); }} />}
      {open && <UnitDrawer projectId={projectId} projectName={projectName} unit={open} canShare={canShare} onChange={replace} onReload={load} onClose={() => setOpen(null)} onDeleted={() => { setOpen(null); load(); }} />}
    </div>
  );
}

function AddUnits({ projectId, onClose, onAdded }: { projectId: string; onClose: () => void; onAdded: () => void }) {
  const [mode, setMode] = useState<"block" | "houses" | "one">("block");
  const [g, setG] = useState({ block: "A", floors: "4", perFloor: "4", ground: true, type: "2 bedroom", count: "20", prefix: "House ", code: "", clientName: "", clientPhone: "", clientEmail: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setG((x) => ({ ...x, [k]: v }));
  const total = mode === "block" ? (Number(g.floors) + (g.ground ? 1 : 0)) * Number(g.perFloor || 0) : mode === "houses" ? Number(g.count || 0) : 1;
  const sample = mode === "block" ? [`${g.block ? `${g.block}-` : ""}${g.ground ? "G" : "1"}01`, `${g.block ? `${g.block}-` : ""}${g.floors}${String(Number(g.perFloor) || 1).padStart(2, "0")}`].join(" … ") : mode === "houses" ? `${g.prefix}1 … ${g.prefix}${g.count}` : g.code;
  const save = async () => {
    setBusy(true);
    try {
      const r = mode === "one"
        ? await api.addUnits(projectId, { code: g.code, type: g.type, block: g.block || undefined, clientName: g.clientName, clientPhone: g.clientPhone, clientEmail: g.clientEmail } as any)
        : await api.addUnits(projectId, { generate: mode === "block" ? { block: g.block, floors: Number(g.floors), perFloor: Number(g.perFloor), groundFloor: g.ground, type: g.type } : { count: Number(g.count), prefix: g.prefix, type: g.type } });
      toast.success(`${r.added} unit${r.added === 1 ? "" : "s"} added${r.skipped ? ` (${r.skipped} already existed)` : ""}`);
      onAdded();
    } catch (e: any) { toast.error(e?.message || "Couldn't add the units."); }
    setBusy(false);
  };
  return (
    <Modal title="Add units" subtitle="Each unit gets stages for its type (apartment or house), which you can tick as work finishes." onClose={onClose}>
      <div className="flex gap-1.5 mb-4" role="tablist">
        {([["block", "Apartment block"], ["houses", "Estate houses"], ["one", "One unit"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={mode === k} onClick={() => { setMode(k); if (k === "houses" && /bedroom$/.test(g.type)) set("type", "3 bedroom bungalow"); }}
            className={`h-8 px-3 rounded-full text-[12px] border ${mode === k ? "border-[#FF6B1A] text-white bg-[#FF6B1A]/10" : "border-[#222A35] text-[#8A95A5]"}`}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {mode === "block" && <>
          <Field label="Block name"><input className={input} value={g.block} onChange={(e) => set("block", e.target.value)} placeholder="A" /></Field>
          <Field label="Unit type"><input className={input} value={g.type} onChange={(e) => set("type", e.target.value)} placeholder="2 bedroom" /></Field>
          <Field label="Floors above ground"><input className={input} type="number" min={1} value={g.floors} onChange={(e) => set("floors", e.target.value)} /></Field>
          <Field label="Units per floor"><input className={input} type="number" min={1} value={g.perFloor} onChange={(e) => set("perFloor", e.target.value)} /></Field>
          <label className="col-span-2 flex items-center gap-2 text-[12.5px] text-[#C2CAD6]"><input type="checkbox" checked={g.ground} onChange={(e) => set("ground", e.target.checked)} /> Units on the ground floor too</label>
        </>}
        {mode === "houses" && <>
          <Field label="How many houses"><input className={input} type="number" min={1} value={g.count} onChange={(e) => set("count", e.target.value)} /></Field>
          <Field label="Name them"><input className={input} value={g.prefix} onChange={(e) => set("prefix", e.target.value)} placeholder="House " /></Field>
          <Field label="House type" className="col-span-2"><input className={input} value={g.type} onChange={(e) => set("type", e.target.value)} placeholder="3 bedroom bungalow" /></Field>
        </>}
        {mode === "one" && <>
          <Field label="Unit number"><input className={input} value={g.code} onChange={(e) => set("code", e.target.value)} placeholder="A-12" /></Field>
          <Field label="Type"><input className={input} value={g.type} onChange={(e) => set("type", e.target.value)} /></Field>
          <Field label="Buyer"><input className={input} value={g.clientName} onChange={(e) => set("clientName", e.target.value)} /></Field>
          <Field label="Buyer's phone"><input className={input} value={g.clientPhone} onChange={(e) => set("clientPhone", e.target.value)} placeholder="07…" /></Field>
          <Field label="Buyer's email" className="col-span-2"><input className={input} type="email" value={g.clientEmail} onChange={(e) => set("clientEmail", e.target.value)} /></Field>
        </>}
      </div>
      {mode !== "one" && <div className="mt-3 text-[12px] text-[#8A95A5]">{total > 0 ? <>Makes <b className="text-white">{total}</b> units: {sample}</> : "Fill in the numbers above."}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} onClick={save} disabled={busy || (mode === "one" ? !g.code.trim() : total <= 0)}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Add {total > 1 ? `${total} units` : "unit"}</button>
      </div>
    </Modal>
  );
}

function UnitDrawer({ projectId, projectName, unit, canShare, onChange, onReload, onClose, onDeleted }: { projectId: string; projectName: string; unit: UnitDto; canShare: boolean; onChange: (u: UnitDto) => void; onReload: () => void; onClose: () => void; onDeleted: () => void }) {
  // Snags in this unit: fixed before handover, and seen by the buyer.
  const [snags, setSnags] = useState<any[] | null>(null);
  const [sn, setSn] = useState({ title: "", area: "" });
  const loadSnags = () => api.listPunch({ projectId, unitId: unit.id }).then(setSnags).catch(() => setSnags([]));
  useEffect(() => { loadSnags(); }, [unit.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const isOpen = (s: any) => !["resolved", "closed", "rejected"].includes(s.status);
  const addSnag = async () => {
    if (!sn.title.trim()) return toast.error("Describe the snag.");
    try { await api.createPunchItem({ projectId, unitId: unit.id, title: sn.title.trim(), desc: sn.title.trim(), area: sn.area || unit.code, status: "open", priority: "medium", category: "other" }); setSn({ title: "", area: "" }); await loadSnags(); onReload(); }
    catch (e: any) { toast.error(e?.message || "Couldn't add the snag."); }
  };
  const fixSnag = async (s: any) => {
    try { await api.setPunchStatus(s.id, isOpen(s) ? "resolved" : "open", "manager"); await loadSnags(); onReload(); }
    catch (e: any) { toast.error(e?.message || "Couldn't update the snag."); }
  };
  // The PDF report: made here, uploaded, then sent as a link.
  const [pdf, setPdf] = useState<{ url?: string; busy: boolean }>({ busy: false });
  const makePdf = async () => {
    setPdf({ busy: true });
    try {
      const u = unit.link ? unit : await api.shareUnit(projectId, unit.id);
      if (!unit.link) onChange(u);
      const { blob, fileName } = await unitReportPdf(projectId, projectName, u);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      let url: string | undefined;
      if (canShare) { const up = await api.uploadFiles([new File([blob], fileName, { type: "application/pdf" })]); url = up.urls[0]; }
      setPdf({ url, busy: false });
      toast.success(url ? "PDF downloaded. Send it to the buyer below." : "PDF downloaded.");
    } catch (e: any) { setPdf({ busy: false }); toast.error(e?.message || "Couldn't make the PDF."); }
  };
  const sendPdf = async (via: "email" | "whatsapp") => {
    const w = via === "whatsapp" ? window.open("about:blank", "_blank") : null;
    try {
      const r = await api.unitReport(projectId, unit.id, via === "email", pdf.url);
      if (w) w.location.href = wa(unit.clientPhone, r.text);
      if (via === "email") toast.success(r.emailed.length ? `PDF report emailed to ${r.emailed.join(", ")}` : "No buyer email yet. Send it on WhatsApp.");
    } catch (e: any) { w?.close(); toast.error(e?.message || "Couldn't send."); }
  };
  const [f, setF] = useState({ code: unit.code, type: unit.type || "", clientName: unit.clientName || "", clientPhone: unit.clientPhone || "", clientEmail: unit.clientEmail || "", priceKES: unit.priceKES ?? "", paidKES: unit.paidKES ?? "", notes: unit.notes || "" });
  const [saving, setSaving] = useState(false);
  const [up, setUp] = useState({ title: "", body: "" });
  const [media, setMedia] = useState<Media[]>([]);
  const [posting, setPosting] = useState(false);
  const [newStage, setNewStage] = useState("");
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify({ code: unit.code, type: unit.type || "", clientName: unit.clientName || "", clientPhone: unit.clientPhone || "", clientEmail: unit.clientEmail || "", priceKES: unit.priceKES ?? "", paidKES: unit.paidKES ?? "", notes: unit.notes || "" });

  const patch = async (payload: Parameters<typeof api.updateUnit>[2]) => {
    try { onChange(await api.updateUnit(projectId, unit.id, payload)); } catch (e: any) { toast.error(e?.message || "Couldn't save."); }
  };
  const save = async () => { setSaving(true); await patch(f as any); setSaving(false); toast.success("Saved"); };
  // Tick at once (site connections are slow); the server's answer settles the progress.
  const toggle = (name: string, done: boolean) => {
    onChange({ ...unit, stages: unit.stages.map((s) => (s.name === name ? { ...s, done } : s)) });
    return patch(done ? { done: [name] } : { undone: [name] });
  };
  const addStage = () => { if (!newStage.trim()) return; patch({ stages: [...unit.stages, { name: newStage.trim(), done: false }] }); setNewStage(""); };
  const removeStage = (name: string) => patch({ stages: unit.stages.filter((s) => s.name !== name) });

  const ensureLink = async () => { const r = await api.shareUnit(projectId, unit.id); onChange(r); return r.link!; };
  const copyLink = async () => { try { const l = unit.link || await ensureLink(); await navigator.clipboard.writeText(l); toast.success("Link copied. Only this unit's buyer should get it."); } catch (e: any) { toast.error(e?.message || "Couldn't make the link."); } };
  const invite = async () => {
    try { const r = await api.shareUnit(projectId, unit.id, { email: f.clientEmail }); onChange(r); toast.success(`Invite emailed to ${r.invited}. Their account shows only unit ${unit.code}.`); }
    catch (e: any) { toast.error(e?.message || "Couldn't invite."); }
  };
  const report = async (via: "email" | "whatsapp") => {
    // Open the WhatsApp tab straight away (browsers block pop-ups opened after a wait).
    const w = via === "whatsapp" ? window.open("about:blank", "_blank") : null;
    try {
      const r = await api.unitReport(projectId, unit.id, via === "email");
      if (w) w.location.href = wa(unit.clientPhone || f.clientPhone, r.text);
      if (via === "email") toast.success(r.emailed.length ? `Report emailed to ${r.emailed.join(", ")}` : "No buyer email yet. Add one, or send it on WhatsApp.");
      onChange({ ...unit, link: r.link, lastReportAt: new Date().toISOString() });
    } catch (e: any) { w?.close(); toast.error(e?.message || "Couldn't make the report."); }
  };
  const post = async () => {
    if (!up.title.trim()) return toast.error("Give the update a short title.");
    setPosting(true);
    try { await api.postUnitUpdate(projectId, unit.id, { ...up, media }); setUp({ title: "", body: "" }); setMedia([]); onChange({ ...unit, updates: (unit.updates || 0) + 1 }); toast.success(`Shared with unit ${unit.code}'s buyer.`); }
    catch (e: any) { toast.error(e?.message || "Couldn't share."); }
    setPosting(false);
  };
  const del = async () => {
    if (!window.confirm(`Delete unit ${unit.code}? Its buyer loses access.`)) return;
    try { await api.deleteUnit(projectId, unit.id); onDeleted(); } catch (e: any) { toast.error(e?.message || "Couldn't delete."); }
  };

  return (
    <Modal wide title={`Unit ${unit.code}`} subtitle={`${projectName}${unit.type ? ` · ${unit.type}` : ""} · ${unit.progress}% · ${statusOf(unit.status).label}`} onClose={onClose}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <div className="text-[12px] text-white mb-2 flex items-center gap-2">Stages <span className="text-[#5B6675]">tick as work finishes</span>
            <select aria-label="Status" className="ml-auto h-7 rounded-md bg-[#0A0E14] border border-[#222A35] px-2 text-[11.5px] text-white" value={unit.status} onChange={(e) => patch({ status: e.target.value })}>{STATUS.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</select>
          </div>
          <Bar pct={unit.progress} tone={unit.progress >= 100 ? "good" : "brand"} className="h-2 mb-3" />
          <div className="space-y-1">
            {unit.stages.map((s) => (
              <div key={s.name} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[#0A0E14]">
                <input type="checkbox" checked={s.done} onChange={(e) => toggle(s.name, e.target.checked)} aria-label={s.name} className="accent-[#FF6B1A] w-4 h-4" />
                <span className={`text-[12.5px] flex-1 ${s.done ? "text-[#8A95A5] line-through" : "text-[#D5DBE3]"}`}>{s.name}</span>
                {s.doneAt && <span className="text-[10.5px] text-[#5B6675]">{new Date(s.doneAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                <button onClick={() => removeStage(s.name)} className="opacity-0 group-hover:opacity-100 text-[#5B6675] hover:text-[#EF4444]" aria-label={`Remove ${s.name}`}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2"><input className={input} value={newStage} onChange={(e) => setNewStage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStage()} placeholder="Add a stage" aria-label="Add a stage" /><button className={btnGhost} onClick={addStage}><Plus className="w-4 h-4" /></button></div>

          <div className="mt-5 text-[12px] text-white mb-2 flex items-center gap-2"><Wrench className="w-3.5 h-3.5 text-[#FBBF24]" /> Snags
            <span className="text-[#5B6675]">{snags ? `${snags.filter(isOpen).length} open · the buyer sees these` : ""}</span></div>
          <div className="space-y-1">
            {(snags || []).map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 bg-[#0A0E14] border border-[#222A35]">
                <input type="checkbox" checked={!isOpen(s)} onChange={() => fixSnag(s)} aria-label={`Fixed: ${s.title || s.desc}`} className="accent-[#22C55E] w-4 h-4" />
                <span className={`text-[12.5px] flex-1 min-w-0 truncate ${isOpen(s) ? "text-[#D5DBE3]" : "text-[#8A95A5] line-through"}`}>{s.title || s.desc}{s.area && s.area !== unit.code && s.area !== "—" ? <span className="text-[#5B6675]"> · {s.area}</span> : null}</span>
                <span className="text-[10.5px] text-[#5B6675] capitalize">{String(s.status).replace(/_/g, " ")}</span>
              </div>
            ))}
            {snags && !snags.length && <div className="text-[11.5px] text-[#5B6675]">No snags. Add any found at the walk-through; the unit can't be marked ready while any are open.</div>}
          </div>
          <div className="grid grid-cols-[1fr_110px_auto] gap-2 mt-2">
            <input className={input} value={sn.title} onChange={(e) => setSn((x) => ({ ...x, title: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && addSnag()} placeholder="e.g. Cracked tile by the shower" aria-label="New snag" />
            <input className={input} value={sn.area} onChange={(e) => setSn((x) => ({ ...x, area: e.target.value }))} placeholder="Room" aria-label="Snag room" />
            <button className={btnGhost} onClick={addSnag} aria-label="Add snag"><Plus className="w-4 h-4" /></button>
          </div>

          <div className="mt-5 text-[12px] text-white mb-2">Post an update for this unit only</div>
          <input className={input} value={up.title} onChange={(e) => setUp((x) => ({ ...x, title: e.target.value }))} placeholder="e.g. Kitchen tiles done" aria-label="Update title" />
          <textarea className={`${textarea} mt-2`} value={up.body} onChange={(e) => setUp((x) => ({ ...x, body: e.target.value }))} placeholder="Details (optional)" aria-label="Update details" />
          <div className="mt-2"><MediaPicker value={media} onChange={setMedia} compact /></div>
          <button className={`${btnPrimary} mt-2`} onClick={post} disabled={posting}>{posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Share with the buyer</button>
        </div>

        <div>
          <div className="text-[12px] text-white mb-2">Buyer and details</div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Unit number"><input className={input} value={f.code} onChange={(e) => set("code", e.target.value)} /></Field>
            <Field label="Type"><input className={input} value={f.type} onChange={(e) => set("type", e.target.value)} /></Field>
            <Field label="Buyer" className="col-span-2"><input className={input} value={f.clientName} onChange={(e) => set("clientName", e.target.value)} /></Field>
            <Field label="Phone (WhatsApp)"><input className={input} value={f.clientPhone} onChange={(e) => set("clientPhone", e.target.value)} placeholder="07…" /></Field>
            <Field label="Email"><input className={input} type="email" value={f.clientEmail} onChange={(e) => set("clientEmail", e.target.value)} /></Field>
            <Field label="Price (KES)"><input className={input} type="number" value={f.priceKES} onChange={(e) => set("priceKES", e.target.value)} /></Field>
            <Field label="Paid so far (KES)"><input className={input} type="number" value={f.paidKES} onChange={(e) => set("paidKES", e.target.value)} /></Field>
            <Field label="Notes (team only)" className="col-span-2"><textarea className={textarea} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          </div>
          <div className="flex gap-2 mt-2">
            <button className={btnPrimary} onClick={save} disabled={!dirty || saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save</button>
            <button className={`${btnGhost} ml-auto`} onClick={del}><Trash2 className="w-4 h-4" /> Delete</button>
          </div>

          {canShare && (
            <div className="mt-5 rounded-xl border border-[#222A35] bg-[#0A0E14] p-3.5">
              <div className="text-[12px] text-white">Keep the buyer informed</div>
              <div className="text-[11.5px] text-[#8A95A5] mt-0.5 mb-3">They see this unit's stages, photos and invoices plus news about the whole project, never other buyers' units.</div>
              <div className="flex flex-wrap gap-2">
                <button className={btnGhost} onClick={makePdf} disabled={pdf.busy}>{pdf.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} PDF report</button>
                <button className={btnGhost} onClick={() => report("whatsapp")}><MessageCircle className="w-4 h-4" /> WhatsApp report</button>
                <button className={btnGhost} onClick={() => report("email")}><Mail className="w-4 h-4" /> Email report</button>
                <button className={btnGhost} onClick={copyLink}>{unit.link ? <Copy className="w-4 h-4" /> : <Link2 className="w-4 h-4" />} {unit.link ? "Copy link" : "Make private link"}</button>
                <button className={btnGhost} onClick={invite} disabled={!f.clientEmail}><UserPlus className="w-4 h-4" /> Invite to a client account</button>
              </div>
              {pdf.url && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px] text-[#C2CAD6]">PDF ready:
                  <button className="text-[#25D366] inline-flex items-center gap-1" onClick={() => sendPdf("whatsapp")}><MessageCircle className="w-3.5 h-3.5" /> Send on WhatsApp</button>
                  <button className="text-[#FF8A47] inline-flex items-center gap-1" onClick={() => sendPdf("email")}><Mail className="w-3.5 h-3.5" /> Email it</button>
                </div>
              )}
              {(unit.accounts?.length || unit.lastReportAt) ? <div className="text-[11px] text-[#5B6675] mt-2.5">{unit.accounts?.length ? `Account: ${unit.accounts.map((a) => `${a.email}${a.joined ? "" : " (invited)"}`).join(", ")}. ` : ""}{unit.lastReportAt ? `Last report ${new Date(unit.lastReportAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.` : ""}</div> : null}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
