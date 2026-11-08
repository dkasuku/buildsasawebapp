// A buyer's private page for their unit in an apartment block or estate
// (/?unit=TOKEN, no account needed): their unit's stages and progress, photos
// and updates for their unit plus news about the whole project, and their own
// invoices. Nothing about the other units or buyers. Light and plain: the reader
// is a buyer on a phone, often abroad.
import { useEffect, useState } from "react";
import { Building2, Camera, Check, Loader2, Receipt, Wrench } from "lucide-react";
import api, { absoluteFileUrl, type PublicUnitDto, type UnitStage } from "../../services/api";

const kes = (n: number) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;
const day = (d?: string | null) => { if (!d) return ""; const t = new Date(d); return isNaN(+t) ? String(d) : t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
const C = { ink: "#1B1F24", soft: "#5B6675", faint: "#8A95A5", line: "#E6E9EE", brand: "#F45B1E", navy: "#0B2A4A", green: "#16A34A" };
const card: React.CSSProperties = { background: "#fff", borderRadius: 14, border: `1px solid ${C.line}`, boxShadow: "0 1px 3px rgba(0,0,0,.05)" };

/** Snags in the unit: what is still being fixed before handover. Shared with the client account. */
export function UnitSnags({ snags, dark }: { snags: { code?: string; title: string; area?: string; status: string; photos?: string[] }[]; dark?: boolean }) {
  if (!snags.length) return null;
  const open = snags.filter((s) => !["resolved", "closed", "rejected"].includes(s.status));
  const ink = dark ? "#FFFFFF" : C.ink, soft = dark ? "#8A95A5" : C.soft;
  return (
    <div>
      <div className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 600, color: ink }}><Wrench className="w-4 h-4" style={{ color: "#F59E0B" }} /> Snags before handover <span style={{ fontWeight: 400, fontSize: 12.5, color: soft }}>{open.length ? `${open.length} being fixed` : "all fixed"}</span></div>
      <div className="mt-2 space-y-1.5">
        {snags.map((s, i) => {
          const fixed = !open.includes(s);
          return (
            <div key={(s.code || "") + i} className="flex items-center gap-2" style={{ fontSize: 13, color: fixed ? soft : ink }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: fixed ? C.green : "#F59E0B" }} />
              <span className="flex-1" style={{ textDecoration: fixed ? "line-through" : "none" }}>{s.title}{s.area ? <span style={{ color: soft }}> · {s.area}</span> : null}</span>
              <span style={{ fontSize: 11, color: fixed ? C.green : "#B45309" }}>{fixed ? "Fixed" : "Being fixed"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The unit's stages as a checklist with a progress bar. Shared with the client account. */
export function UnitStages({ code, type, progress, statusLabel, stages, dark }: { code: string; type?: string | null; progress: number; statusLabel?: string; stages: UnitStage[]; dark?: boolean }) {
  const ink = dark ? "#FFFFFF" : C.ink, soft = dark ? "#8A95A5" : C.soft;
  return (
    <div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <div style={{ fontSize: 18, fontWeight: 700, color: ink }}>Unit {code}</div>
        {type && <div style={{ fontSize: 13, color: soft }}>{type}</div>}
        <div style={{ marginLeft: "auto", fontSize: 13, color: progress >= 100 ? C.green : C.brand, fontWeight: 600 }}>{progress}%{statusLabel ? ` · ${statusLabel}` : ""}</div>
      </div>
      <div style={{ height: 10, borderRadius: 6, background: dark ? "#222A35" : "#EEF0F3", marginTop: 10, overflow: "hidden" }}><div style={{ height: 10, width: `${progress}%`, background: progress >= 100 ? C.green : C.brand, borderRadius: 6 }} /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mt-3">
        {stages.map((s) => (
          <div key={s.name} className="flex items-center gap-2" style={{ fontSize: 13, color: s.done ? ink : soft }}>
            <span style={{ width: 18, height: 18, borderRadius: 9, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: s.done ? C.green : "transparent", border: s.done ? "none" : `1.5px solid ${dark ? "#2C3744" : C.line}` }}>{s.done && <Check className="w-3 h-3" style={{ color: "#fff" }} />}</span>
            <span className="flex-1">{s.name}</span>
            {s.doneAt && <span style={{ fontSize: 11, color: soft }}>{day(s.doneAt)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PublicUnitView({ token }: { token: string }) {
  const [d, setD] = useState<PublicUnitDto | null>(null);
  const [err, setErr] = useState("");
  const [big, setBig] = useState<string | null>(null);
  useEffect(() => { api.getPublicUnit(token).then(setD).catch((e) => setErr(e?.message || "This unit link is not available.")); }, [token]);

  if (err) return <div style={{ minHeight: "100vh", background: "#F4F6FA", color: C.ink }} className="flex items-center justify-center p-6 text-center"><div style={{ ...card, padding: 24, maxWidth: 420 }}><Building2 className="w-6 h-6 mx-auto mb-2" style={{ color: C.faint }} />{err}</div></div>;
  if (!d) return <div style={{ minHeight: "100vh", background: "#F4F6FA" }} className="flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.faint }} /></div>;
  const { unit: u, project: p, company } = d;
  const owed = d.invoices.reduce((s, i) => s + Math.max(0, i.amount - (i.paidAmount || 0)), 0);

  return (
    <div style={{ minHeight: "100vh", background: "#F4F6FA", color: C.ink, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ background: C.navy }}>
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-2.5">
          {company?.logoUrl ? <img src={absoluteFileUrl(company.logoUrl)} alt="" style={{ height: 30, borderRadius: 6, background: "#fff", padding: 2 }} /> : null}
          <div style={{ color: "#fff", fontWeight: 600, fontSize: 15 }} className="truncate">{company?.name || "Your developer"}</div>
          <div style={{ marginLeft: "auto", color: "#AFC3D9", fontSize: 12 }}>Unit progress</div>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        <div>
          <div style={{ fontSize: 13, color: C.soft }}>{p.name}{p.city && p.city !== "—" ? ` · ${p.city}` : ""}</div>
          {u.clientName && <div style={{ fontSize: 14, marginTop: 2 }}>Hello {u.clientName.split(" ")[0]}, here is how your unit is coming along.</div>}
        </div>
        <div style={{ ...card, padding: 16 }}>
          <UnitStages code={u.code} type={u.type} progress={u.progress} statusLabel={u.statusLabel} stages={u.stages} />
          <div style={{ fontSize: 12, color: C.faint, marginTop: 12 }}>
            {[u.block ? `Block ${u.block}` : "", u.floor ? `Floor ${u.floor}` : "", u.sizeSqm ? `${u.sizeSqm} m²` : "", `The whole project is ${p.progress}% complete`, p.targetEndDate ? `target completion ${day(p.targetEndDate)}` : ""].filter(Boolean).join(" · ")}
          </div>
        </div>

        {(d.invoices.length > 0 || u.priceKES) && (
          <div style={{ ...card, padding: 16 }}>
            <div className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 600 }}><Receipt className="w-4 h-4" style={{ color: C.brand }} /> Payments</div>
            {u.priceKES ? <div style={{ fontSize: 13, color: C.soft, marginTop: 6 }}>Price {kes(u.priceKES)}{u.paidKES ? ` · paid ${kes(u.paidKES)} · balance ${kes(Math.max(0, u.priceKES - u.paidKES))}` : ""}</div> : null}
            {d.invoices.map((i) => (
              <div key={i.invoiceNumber} className="flex items-center gap-2 py-2" style={{ borderTop: `1px solid ${C.line}`, fontSize: 13, marginTop: 6 }}>
                <span className="flex-1">{i.invoiceNumber}<span style={{ color: C.faint }}> · due {day(i.dueDate)}</span></span>
                <span>{kes(i.amount)}</span>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: i.status === "paid" ? "#DCFCE7" : "#FEF3C7", color: i.status === "paid" ? C.green : "#B45309" }}>{i.status}</span>
              </div>
            ))}
            {owed > 0 && <div style={{ fontSize: 12.5, color: C.soft, marginTop: 6 }}>Outstanding on invoices: <b style={{ color: C.ink }}>{kes(owed)}</b></div>}
          </div>
        )}

        {(d.snags?.length || 0) > 0 && <div style={{ ...card, padding: 16 }}><UnitSnags snags={d.snags!} /></div>}

        {(d.photos?.length || 0) > 0 && (
          <div style={{ ...card, padding: 16 }}>
            <div className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 600 }}><Camera className="w-4 h-4" style={{ color: C.brand }} /> Site photos</div>
            <div className="grid grid-cols-3 gap-1.5 mt-2.5">
              {d.photos!.flatMap((l) => l.photos.map((p) => ({ p, l }))).slice(0, 12).map(({ p, l }) => (
                <button key={p} onClick={() => setBig(absoluteFileUrl(p))} className="relative aspect-square rounded-lg overflow-hidden" title={day(l.date)}>
                  <img src={absoluteFileUrl(p)} alt="" className="w-full h-full object-cover" />
                  {l.scope === "unit" && <span className="absolute bottom-1 left-1 text-[10px] px-1.5 rounded" style={{ background: C.brand, color: "#fff" }}>Your unit</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ fontSize: 14, fontWeight: 600 }}>Updates</div>
        {d.updates.length === 0 && <div style={{ ...card, padding: 16, fontSize: 13, color: C.soft }}>No updates yet. Photos of your unit and news about the project will appear here.</div>}
        {d.updates.map((x) => (
          <div key={x.id} style={{ ...card, padding: 14 }}>
            <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 11.5, color: C.faint }}>
              <span style={{ padding: "1px 8px", borderRadius: 10, background: x.scope === "unit" ? "#FFEDE3" : "#EEF2F7", color: x.scope === "unit" ? C.brand : C.navy }}>{x.scope === "unit" ? `Your unit ${u.code}` : "Whole project"}</span>
              <span>{day(x.createdAt)}{x.authorName ? ` · ${x.authorName}` : ""}</span>
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 6 }}>{x.title}</div>
            {x.body && <div style={{ fontSize: 13, color: C.soft, marginTop: 4, whiteSpace: "pre-wrap" }}>{x.body}</div>}
            {x.media.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5 mt-2.5">
                {x.media.slice(0, 9).map((m) => m.type === "video"
                  ? <video key={m.url} src={absoluteFileUrl(m.url)} controls className="w-full aspect-square object-cover rounded-lg bg-black" />
                  : m.type === "file" ? <a key={m.url} href={absoluteFileUrl(m.url)} target="_blank" rel="noreferrer" className="aspect-square rounded-lg flex items-center justify-center text-center p-2" style={{ border: `1px solid ${C.line}`, fontSize: 11.5, color: C.navy }}>{m.name || "Document"}</a>
                  : <button key={m.url} onClick={() => setBig(absoluteFileUrl(m.url))} className="aspect-square rounded-lg overflow-hidden"><img src={absoluteFileUrl(m.url)} alt="" className="w-full h-full object-cover" /></button>)}
              </div>
            )}
          </div>
        ))}
        <div style={{ fontSize: 11.5, color: C.faint, textAlign: "center", padding: "8px 0 20px" }}>This page is private to the buyer of unit {u.code}. Powered by Buildsasa.</div>
      </div>
      {big && <div onClick={() => setBig(null)} className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"><img src={big} alt="" className="max-w-full max-h-full rounded-lg" /></div>}
    </div>
  );
}
